/**
 * 订阅聚合缓存服务
 * 
 * 负责管理订阅源的聚合、缓存和刷新逻辑。
 * 核心功能：
 * - 聚合多个订阅源的节点
 * - 缓存聚合结果（节点和格式化内容）
 * - 分布式锁防止并发刷新
 * - 缓存一致性检查
 * - 等待缓存刷新完成
 */

import { sleep } from '../utils/async';
import {
  getAggregateTtlSeconds,
  getAppMetaValue,
  setAppMetaValue,
  randomToken
} from '../utils/runtime';
import {
  deduplicateNodes,
  renderFormat,
  type AggregateMeta,
  type AggregateWarning,
  type CachedFormatPayload,
  type CachedNodesPayload,
  type NormalizedNode,
  type OutputFormat,
  type SourceRecord
} from '@riku-hub/shared';

// 类型定义
interface Env {
  CACHE_KV: KVNamespace;
  APP_KV: KVNamespace;
  DB?: D1Database;
  AGGREGATE_TTL_SECONDS?: string;
}

// 常量
const APP_KEYS = {
  aggregateMeta: 'config:aggregate-meta',
  refreshLock: 'lock:refresh-aggregate'
};

const CACHE_KEYS = {
  nodes: 'cache:nodes',
  format: (format: OutputFormat) => `cache:format:${format}`
};

/**
 * 刷新聚合缓存
 * 
 * 使用分布式锁防止并发刷新，支持强制刷新模式。
 * 
 * @param env - 环境变量
 * @param force - 是否强制等待刷新完成
 * @param getAllSources - 获取所有订阅源的函数
 * @param expandSourceContent - 展开订阅源内容的函数
 * @param saveSourceNodeCount - 保存订阅源节点数的函数
 * @param appendLog - 记录日志的函数
 * @returns 刷新结果
 */
export async function refreshAggregateCache(
  env: Env,
  force: boolean,
  getAllSources: (env: Env) => Promise<SourceRecord[]>,
  expandSourceContent: (
    env: Env,
    content: string
  ) => Promise<{ uniqueNodes: NormalizedNode[]; warnings: AggregateWarning[] }>,
  saveSourceNodeCount: (env: Env, source: SourceRecord, nodeCount: number) => Promise<SourceRecord>,
  appendLog: (env: Env, type: string, message: string) => Promise<void>
): Promise<
  | { ok: true; payload: CachedNodesPayload; sources: SourceRecord[] }
  | { ok: false; error: string }
> {
  // 尝试获取锁，避免并发刷新
  const lockKey = APP_KEYS.refreshLock;
  const lockValue = `${randomToken(8)}-${Date.now()}`;
  const lockTtl = 120; // 2分钟锁超时
  let lockAcquired = false;

  try {
    // 检查是否已有锁
    const existingLock = await env.CACHE_KV.get(lockKey);
    if (existingLock) {
      // 检查锁是否过期（防止死锁）
      const lockParts = existingLock.split('-');
      const lockTime = lockParts.length > 1 ? Number.parseInt(lockParts[1], 10) : 0;
      const isExpired = Date.now() - lockTime > lockTtl * 1000;

      if (!isExpired) {
        if (force) {
          const baseline = await getCachedNodes(env);
          const waited = await waitForNodesCache(env, 6000, baseline?.refreshedAt ?? null);
          if (waited) {
            const sources = await getAllSources(env);
            return { ok: true, payload: waited, sources };
          }
          return { ok: false, error: '刷新正在进行中' };
        }

        // 记录锁竞争日志
        await appendLog(
          env,
          'refresh_lock_contention',
          `检测到并发刷新请求，返回缓存（锁持有时间: ${Date.now() - lockTime}ms）`
        );

        // 已有其他进程在刷新，直接返回当前缓存
        const cached = await getCachedNodes(env);
        if (cached) {
          const sources = await getAllSources(env);
          return { ok: true, payload: cached, sources };
        }
        return { ok: false, error: '刷新正在进行中' };
      } else {
        // 记录锁过期日志
        await appendLog(
          env,
          'refresh_lock_expired',
          `检测到过期锁，强制获取（锁持有时间: ${Date.now() - lockTime}ms）`
        );
      }
    }

    // 获取锁（即使有竞争，也只是重复刷新，不会破坏数据）
    await env.CACHE_KV.put(lockKey, lockValue, { expirationTtl: lockTtl });
    lockAcquired = true;
    const confirmedLock = await env.CACHE_KV.get(lockKey);
    if (confirmedLock !== lockValue) {
      if (force) {
        const baseline = await getCachedNodes(env);
        const waited = await waitForNodesCache(env, 6000, baseline?.refreshedAt ?? null);
        if (waited) {
          const sources = await getAllSources(env);
          return { ok: true, payload: waited, sources };
        }
        return { ok: false, error: '刷新正在进行中' };
      }

      const cached = await getCachedNodes(env);
      if (cached) {
        const sources = await getAllSources(env);
        return { ok: true, payload: cached, sources };
      }
      return { ok: false, error: '刷新正在进行中' };
    }

    const sources = await getAllSources(env);
    // 只聚合启用的订阅源
    const enabledSources = sources.filter((s) => s.enabled);

    if (enabledSources.length === 0) {
      await saveAggregateMeta(env, {
        cacheStatus: 'missing',
        totalNodes: 0,
        warningCount: 0,
        lastRefreshTime: '',
        lastRefreshError: '没有启用的订阅源'
      });
      return { ok: false, error: '没有启用的订阅源' };
    }

    const aggregated: NormalizedNode[] = [];
    const warnings: AggregateWarning[] = [];
    const updatedSources: SourceRecord[] = [];

    for (const source of enabledSources) {
      const expanded = await expandSourceContent(env, source.content);
      aggregated.push(...expanded.uniqueNodes);
      warnings.push(...expanded.warnings);

      // 只在节点数变化时才更新 source 记录，避免写放大
      if (expanded.uniqueNodes.length !== source.nodeCount) {
        const updatedSource = await saveSourceNodeCount(env, source, expanded.uniqueNodes.length);
        updatedSources.push(updatedSource);
      } else {
        updatedSources.push(source);
      }
    }

    // 将禁用的订阅源也加入返回列表（但不参与聚合）
    const disabledSources = sources.filter((s) => !s.enabled);
    const allSources = [...updatedSources, ...disabledSources].sort((a, b) => a.sortOrder - b.sortOrder);

    const deduped = deduplicateNodes(aggregated);
    const payload: CachedNodesPayload = {
      nodes: deduped.nodes,
      warnings,
      refreshedAt: new Date().toISOString()
    };

    await env.CACHE_KV.put(CACHE_KEYS.nodes, JSON.stringify(payload));
    for (const format of ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'] satisfies OutputFormat[]) {
      const rendered = renderFormat(payload.nodes, format);
      const cachedFormat: CachedFormatPayload = {
        format,
        content: rendered.content,
        warnings: rendered.warnings,
        refreshedAt: payload.refreshedAt
      };
      await env.CACHE_KV.put(CACHE_KEYS.format(format), JSON.stringify(cachedFormat));
    }

    await saveAggregateMeta(env, {
      cacheStatus: 'fresh',
      totalNodes: payload.nodes.length,
      warningCount: warnings.length,
      lastRefreshTime: payload.refreshedAt,
      lastRefreshError: '',
      nextRefreshAfter: new Date(Date.now() + getAggregateTtlSeconds(env) * 1000).toISOString()
    });

    return { ok: true, payload, sources: allSources };
  } catch (error) {
    const oldCache = await getCachedNodes(env);
    await saveAggregateMeta(env, {
      cacheStatus: oldCache ? 'stale' : 'missing',
      totalNodes: oldCache?.nodes.length ?? 0,
      warningCount: oldCache?.warnings.length ?? 0,
      lastRefreshTime: oldCache?.refreshedAt ?? '',
      lastRefreshError: String(error)
    });
    if (!force && oldCache) {
      const sources = await getAllSources(env);
      return { ok: true, payload: oldCache, sources };
    }
    return { ok: false, error: `刷新聚合缓存失败: ${String(error)}` };
  } finally {
    if (lockAcquired) {
      // 释放锁
      const currentLock = await env.CACHE_KV.get(lockKey);
      if (currentLock === lockValue) {
        await env.CACHE_KV.delete(lockKey);
      }
    }
  }
}

/**
 * 确保聚合缓存可用
 * 
 * 检查缓存是否新鲜，如果过期则触发刷新。
 * 支持等待刷新完成和返回过期缓存。
 * 
 * @param env - 环境变量
 * @param format - 输出格式
 * @param getAllSources - 获取所有订阅源的函数
 * @param expandSourceContent - 展开订阅源内容的函数
 * @param saveSourceNodeCount - 保存订阅源节点数的函数
 * @param appendLog - 记录日志的函数
 * @returns 缓存内容或错误
 */
export async function ensureAggregateCache(
  env: Env,
  format: OutputFormat,
  getAllSources: (env: Env) => Promise<SourceRecord[]>,
  expandSourceContent: (
    env: Env,
    content: string
  ) => Promise<{ uniqueNodes: NormalizedNode[]; warnings: AggregateWarning[] }>,
  saveSourceNodeCount: (env: Env, source: SourceRecord, nodeCount: number) => Promise<SourceRecord>,
  appendLog: (env: Env, type: string, message: string) => Promise<void>
): Promise<
  | {
      ok: true;
      payload: { content: string; warnings: AggregateWarning[]; fromStaleCache: boolean };
      meta: AggregateMeta;
    }
  | { ok: false; error: string; status?: number }
> {
  const ttlSeconds = getAggregateTtlSeconds(env);
  const meta = await getAggregateMeta(env);
  const cachedFormat = await getCachedFormat(env, format);
  const cachedNodes = await getCachedNodes(env);
  const isFresh = cachedNodes ? Date.now() - Date.parse(cachedNodes.refreshedAt) < ttlSeconds * 1000 : false;
  const hasConsistentPair = isCachePairConsistent(cachedNodes, cachedFormat);

  if (hasConsistentPair && isFresh && cachedFormat) {
    return {
      ok: true,
      payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: false },
      meta: { ...meta, cacheStatus: 'fresh' }
    };
  }

  const refreshed = await refreshAggregateCache(
    env,
    false,
    getAllSources,
    expandSourceContent,
    saveSourceNodeCount,
    appendLog
  );
  if (refreshed.ok) {
    const [latest, latestNodes] = await Promise.all([getCachedFormat(env, format), getCachedNodes(env)]);
    const nextMeta = await getAggregateMeta(env);
    if (latest && latestNodes && isCachePairConsistent(latestNodes, latest)) {
      return {
        ok: true,
        payload: {
          content: latest.content,
          warnings: latest.warnings,
          fromStaleCache: nextMeta.cacheStatus === 'stale'
        },
        meta: nextMeta
      };
    }
  }

  if (!refreshed.ok && refreshed.error === '刷新正在进行中') {
    const waited = await waitForFreshenedCache(env, format);
    if (waited) {
      return waited;
    }
    return { ok: false, error: '订阅缓存正在初始化中，请稍后重试', status: 503 };
  }

  if (hasConsistentPair && cachedFormat) {
    return {
      ok: true,
      payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: true },
      meta: { ...meta, cacheStatus: 'stale' }
    };
  }

  return {
    ok: false,
    error: refreshed.ok ? '订阅缓存不可用' : refreshed.error,
    status: refreshed.ok ? 500 : refreshed.error === '刷新正在进行中' ? 503 : 500
  };
}

/**
 * 等待节点缓存刷新完成
 * 
 * @param env - 环境变量
 * @param timeoutMs - 超时时间（毫秒）
 * @param baselineRefreshedAt - 基准刷新时间（用于检测是否有新缓存）
 * @returns 新的缓存数据或 null
 */
export async function waitForNodesCache(
  env: Env,
  timeoutMs: number,
  baselineRefreshedAt: string | null
): Promise<CachedNodesPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cached = await getCachedNodes(env);
    if (cached && (!baselineRefreshedAt || cached.refreshedAt !== baselineRefreshedAt)) {
      return cached;
    }
    await sleep(200);
  }
  return null;
}

/**
 * 等待格式化缓存刷新完成
 * 
 * @param env - 环境变量
 * @param format - 输出格式
 * @returns 缓存内容或 null
 */
async function waitForFreshenedCache(
  env: Env,
  format: OutputFormat
): Promise<
  | {
      ok: true;
      payload: { content: string; warnings: AggregateWarning[]; fromStaleCache: boolean };
      meta: AggregateMeta;
    }
  | null
> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await sleep(200);
    const [cachedFormat, cachedNodes, meta] = await Promise.all([
      getCachedFormat(env, format),
      getCachedNodes(env),
      getAggregateMeta(env)
    ]);
    if (cachedFormat && cachedNodes && isCachePairConsistent(cachedNodes, cachedFormat)) {
      return {
        ok: true,
        payload: {
          content: cachedFormat.content,
          warnings: cachedFormat.warnings,
          fromStaleCache: meta.cacheStatus === 'stale'
        },
        meta
      };
    }
  }
  return null;
}

/**
 * 检查节点缓存和格式化缓存是否一致
 * 
 * @param nodes - 节点缓存
 * @param format - 格式化缓存
 * @returns 是否一致
 */
function isCachePairConsistent(
  nodes: CachedNodesPayload | null,
  format: CachedFormatPayload | null
): boolean {
  if (!nodes || !format) {
    return false;
  }
  return nodes.refreshedAt === format.refreshedAt;
}

/**
 * 获取聚合元数据
 * 
 * @param env - 环境变量
 * @returns 聚合元数据
 */
export async function getAggregateMeta(env: Env): Promise<AggregateMeta> {
  const raw = await getAppMetaValue(env, APP_KEYS.aggregateMeta);
  if (raw) {
    try {
      const meta = JSON.parse(raw) as AggregateMeta;
      if (meta && typeof meta === 'object') {
        return meta;
      }
    } catch {
      // ignore malformed meta and fall back to defaults
    }
  }
  return {
    cacheStatus: 'missing',
    totalNodes: 0,
    warningCount: 0,
    lastRefreshTime: '',
    lastRefreshError: ''
  };
}

/**
 * 保存聚合元数据
 * 
 * @param env - 环境变量
 * @param meta - 聚合元数据
 * @returns 保存的元数据
 */
export async function saveAggregateMeta(env: Env, meta: AggregateMeta): Promise<AggregateMeta> {
  await setAppMetaValue(env, APP_KEYS.aggregateMeta, JSON.stringify(meta));
  return meta;
}

/**
 * 获取缓存的节点数据
 * 
 * @param env - 环境变量
 * @returns 节点缓存或 null
 */
export async function getCachedNodes(env: Env): Promise<CachedNodesPayload | null> {
  return env.CACHE_KV.get(CACHE_KEYS.nodes, 'json');
}

/**
 * 获取缓存的格式化内容
 * 
 * @param env - 环境变量
 * @param format - 输出格式
 * @returns 格式化缓存或 null
 */
export async function getCachedFormat(env: Env, format: OutputFormat): Promise<CachedFormatPayload | null> {
  return env.CACHE_KV.get(CACHE_KEYS.format(format), 'json');
}
