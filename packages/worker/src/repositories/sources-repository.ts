/**
 * 数据源仓库
 * 
 * 负责订阅源的数据访问和持久化。
 * 支持 D1 数据库和 KV 存储两种后端。
 * 
 * 核心功能：
 * - CRUD 操作（创建、读取、更新、删除）
 * - 索引管理（订阅源列表）
 * - 节点数更新（避免写放大）
 * - 双后端支持（D1 优先，KV 降级）
 */

import { hasD1, randomToken } from '../utils/runtime';
import { mapSourceRow } from '../utils/db-mappers';
import type { SourceRecord } from '@riku-hub/shared';
import type { SourceRow } from '../types/db-rows';

// 类型定义
interface Env {
  APP_KV: KVNamespace;
  DB?: D1Database;
}

// 常量
const APP_KEYS = {
  sourceIndex: 'source:index'
};

/**
 * 获取单个订阅源
 * 
 * @param env - 环境变量
 * @param id - 订阅源 ID
 * @returns 订阅源记录或 null
 */
export async function getSource(env: Env, id: string): Promise<SourceRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      'SELECT id, name, content, node_count, sort_order, enabled, created_at, updated_at FROM sources WHERE id = ?'
    )
      .bind(id)
      .first<SourceRow>();
    return row ? mapSourceRow(row) : null;
  }

  const source = await env.APP_KV.get(`source:${id}`, 'json');
  return source as SourceRecord | null;
}

/**
 * 获取所有订阅源
 * 
 * 按 sortOrder 排序返回。
 * 
 * @param env - 环境变量
 * @returns 订阅源列表
 */
export async function getAllSources(env: Env): Promise<SourceRecord[]> {
  const ids = await getSourceIndex(env);
  const records = await Promise.all(ids.map((id) => getSource(env, id)));
  return records.filter((record): record is SourceRecord => Boolean(record)).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 获取订阅源索引（ID 列表）
 * 
 * @param env - 环境变量
 * @returns 订阅源 ID 列表
 */
export async function getSourceIndex(env: Env): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare('SELECT id FROM sources ORDER BY sort_order ASC').all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(APP_KEYS.sourceIndex, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

/**
 * 保存订阅源索引
 * 
 * 仅在 KV 模式下需要，D1 模式下索引由数据库维护。
 * 
 * @param env - 环境变量
 * @param ids - 订阅源 ID 列表
 */
export async function saveSourceIndex(env: Env, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(APP_KEYS.sourceIndex, JSON.stringify(ids));
}

/**
 * 创建订阅源
 * 
 * 自动生成 ID、设置排序顺序、初始化时间戳。
 * 
 * @param env - 环境变量
 * @param name - 订阅源名称
 * @param content - 订阅源内容
 * @param nodeCount - 节点数量
 * @returns 创建的订阅源记录
 */
export async function createSource(
  env: Env,
  name: string,
  content: string,
  nodeCount: number
): Promise<SourceRecord> {
  const ids = await getSourceIndex(env);
  const now = new Date().toISOString();
  const source: SourceRecord = {
    id: randomToken(8),
    name,
    content,
    nodeCount,
    sortOrder: ids.length,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  await saveSource(env, source);
  await saveSourceIndex(env, [...ids, source.id]);
  return source;
}

/**
 * 保存订阅源
 * 
 * 使用 UPSERT 语义（存在则更新，不存在则插入）。
 * 
 * @param env - 环境变量
 * @param source - 订阅源记录
 * @returns 保存的订阅源记录
 */
export async function saveSource(env: Env, source: SourceRecord): Promise<SourceRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
      `INSERT INTO sources (id, name, content, node_count, sort_order, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         content = excluded.content,
         node_count = excluded.node_count,
         sort_order = excluded.sort_order,
         enabled = excluded.enabled,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    )
      .bind(
        source.id,
        source.name,
        source.content,
        source.nodeCount,
        source.sortOrder,
        source.enabled ? 1 : 0,
        source.createdAt,
        source.updatedAt
      )
      .run();
    return source;
  }

  await env.APP_KV.put(`source:${source.id}`, JSON.stringify(source));
  return source;
}

/**
 * 保存订阅源节点数
 * 
 * 优化版本：仅更新 node_count 和 updated_at 字段，避免写放大。
 * 使用乐观锁（WHERE node_count = ?）防止并发更新冲突。
 * 
 * @param env - 环境变量
 * @param source - 订阅源记录
 * @param nodeCount - 新的节点数量
 * @returns 更新后的订阅源记录
 */
export async function saveSourceNodeCount(
  env: Env,
  source: SourceRecord,
  nodeCount: number
): Promise<SourceRecord> {
  const now = new Date().toISOString();

  // D1 模式：使用乐观锁更新
  if (hasD1(env)) {
    await env.DB.prepare('UPDATE sources SET node_count = ?, updated_at = ? WHERE id = ? AND node_count = ?')
      .bind(nodeCount, now, source.id, source.nodeCount)
      .run();
  }

  // 重新读取最新数据（可能被其他进程更新）
  const latest = await getSource(env, source.id);
  if (!latest) {
    // 并发删除场景：不要把已删除订阅源“复活”写回存储
    return {
      ...source,
      nodeCount,
      updatedAt: now
    };
  }

  // 节点数已经是最新的，无需更新
  if (latest.nodeCount === nodeCount) {
    return latest;
  }

  // 更新节点数
  const updated: SourceRecord = {
    ...latest,
    nodeCount,
    updatedAt: now
  };
  await saveSource(env, updated);
  return updated;
}

/**
 * 删除订阅源
 * 
 * 同时删除数据和索引。
 * 
 * @param env - 环境变量
 * @param id - 订阅源 ID
 */
export async function deleteSource(env: Env, id: string): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
    return;
  }

  const ids = await getSourceIndex(env);
  await env.APP_KV.delete(`source:${id}`);
  await saveSourceIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

/**
 * 获取最后保存时间
 * 
 * 返回所有订阅源中最新的 updatedAt 时间戳。
 * 
 * @param sources - 订阅源列表
 * @returns 最后保存时间（ISO 8601 格式）
 */
export function getLastSaveTime(sources: SourceRecord[]): string {
  return sources.reduce((latest, source) => (source.updatedAt > latest ? source.updatedAt : latest), '');
}
