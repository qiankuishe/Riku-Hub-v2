/**
 * 订阅获取服务
 * 
 * 负责从订阅源获取内容、解析节点、处理嵌套订阅等。
 * 核心功能：
 * - 从 URL 获取订阅内容
 * - 解析混合输入（节点 + 订阅链接）
 * - 递归展开嵌套订阅
 * - 并发控制和错误处理
 * - 防止循环引用
 */

import { mapWithConcurrency } from '../utils/async';
import { formatError } from '../utils/error';
import { readResponseTextWithLimit } from '../utils/http';
import { assertSafeUrl } from '../utils/ssrf';
import {
  deduplicateNodes,
  detectInputFormat,
  fixUrl,
  parseContent,
  parseMixedInput,
  type AggregateWarning,
  type NormalizedNode
} from '@riku-hub/shared';

// 类型定义
interface Env {
  CACHE_KV?: KVNamespace;
  APP_KV?: KVNamespace;
  DB?: D1Database;
}

// 常量
const MAX_REDIRECTS = 3;
const MAX_SUBSCRIPTION_EXPANSION_DEPTH = 2;
const MAX_SUBSCRIPTION_FETCH_CONCURRENCY = 8;
const MAX_SUBSCRIPTION_URLS_PER_SOURCE = 64;
const MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * 展开订阅源内容
 * 
 * 解析内容并递归获取嵌套订阅，返回去重后的节点。
 * 
 * @param env - 环境变量
 * @param content - 订阅源内容
 * @returns 去重后的节点和警告
 */
export async function expandSourceContent(
  env: Env,
  content: string
): Promise<{
  uniqueNodes: NormalizedNode[];
  warnings: AggregateWarning[];
}> {
  const resolved = await resolveNodesFromInput(env, content);
  const deduped = deduplicateNodes(resolved.nodes);
  return { uniqueNodes: deduped.nodes, warnings: resolved.warnings };
}

/**
 * 从输入内容解析节点
 * 
 * 支持以下输入格式：
 * 1. 纯节点内容（base64, clash, surge 等）
 * 2. 纯订阅链接
 * 3. 混合内容（节点 + 订阅链接）
 * 
 * 递归处理嵌套订阅，防止循环引用。
 * 
 * @param env - 环境变量
 * @param content - 输入内容
 * @param depth - 当前递归深度
 * @param visitedUrls - 已访问的 URL 集合（防止循环引用）
 * @returns 解析的节点、警告和 URL 数量
 */
export async function resolveNodesFromInput(
  env: Env,
  content: string,
  depth = 0,
  visitedUrls?: Set<string>
): Promise<{ nodes: NormalizedNode[]; warnings: AggregateWarning[]; urlCount: number }> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { nodes: [], warnings: [], urlCount: 0 };
  }

  // 尝试解析混合输入（节点 + 订阅链接）
  const mixed = parseMixedInput(trimmed);
  if (mixed.urls.length === 0 && mixed.nodes.length === 0) {
    // 纯节点内容，直接解析
    const format = detectInputFormat(trimmed);
    const parsed = parseContent(trimmed, format);
    return { nodes: parsed.nodes, warnings: parsed.warnings, urlCount: 0 };
  }

  const nodes = [...mixed.nodes];
  const warnings = [...mixed.warnings];
  const urlsToProcess = mixed.urls.slice(0, MAX_SUBSCRIPTION_URLS_PER_SOURCE);

  // 检查订阅链接数量限制
  if (mixed.urls.length > MAX_SUBSCRIPTION_URLS_PER_SOURCE) {
    warnings.push({
      code: 'fetch-failed',
      message: `订阅链接数量超过限制（${MAX_SUBSCRIPTION_URLS_PER_SOURCE}），已忽略多余链接`,
      context: String(mixed.urls.length)
    });
  }

  let urlCount = urlsToProcess.length;
  const seen = visitedUrls ?? new Set<string>();

  // 检查递归深度限制
  if (depth >= MAX_SUBSCRIPTION_EXPANSION_DEPTH) {
    for (const rawUrl of urlsToProcess) {
      warnings.push({
        code: 'fetch-failed',
        message: `订阅嵌套层级超过限制（${MAX_SUBSCRIPTION_EXPANSION_DEPTH}）`,
        context: rawUrl
      });
    }
    return { nodes, warnings, urlCount };
  }

  // 并发获取订阅内容
  const results = await mapWithConcurrency(
    urlsToProcess,
    MAX_SUBSCRIPTION_FETCH_CONCURRENCY,
    async (rawUrl): Promise<{ nodes: NormalizedNode[]; warnings: AggregateWarning[]; urlCount: number }> => {
      const normalizedUrl = fixUrl(rawUrl);

      // 防止循环引用
      if (seen.has(normalizedUrl)) {
        return { nodes: [], warnings: [], urlCount: 0 };
      }

      seen.add(normalizedUrl);

      try {
        const fetched = await fetchSubscription(env, normalizedUrl);
        return await resolveNodesFromInput(env, fetched.text, depth + 1, seen);
      } catch (error) {
        return {
          nodes: [],
          warnings: [
            {
              code: 'fetch-failed',
              message: formatSubscriptionFetchError(rawUrl, error),
              context: rawUrl
            }
          ],
          urlCount: 0
        };
      }
    }
  );

  // 合并结果
  for (const result of results) {
    nodes.push(...result.nodes);
    warnings.push(...result.warnings);
    urlCount += result.urlCount;
  }

  return { nodes, warnings, urlCount };
}

/**
 * 从 URL 获取订阅内容
 * 
 * 支持以下特性：
 * - 自动处理重定向（最多 3 次）
 * - SSRF 防护
 * - 超时控制（30 秒）
 * - 大小限制（5MB）
 * 
 * @param env - 环境变量
 * @param rawUrl - 订阅 URL
 * @param depth - 重定向深度
 * @returns 订阅内容
 */
async function fetchSubscription(env: Env, rawUrl: string, depth = 0): Promise<{ text: string }> {
  // 检查重定向次数
  if (depth > MAX_REDIRECTS) {
    throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`);
  }

  const url = new URL(fixUrl(rawUrl));
  await assertSafeUrl(env, url);

  // 添加 30 秒超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Riku-Hub/0.1' },
      redirect: 'manual',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('上游返回重定向但缺少 Location');
      }
      const redirected = new URL(location, url);
      return fetchSubscription(env, redirected.toString(), depth + 1);
    }

    // 检查响应状态
    if (!response.ok) {
      const statusText = response.statusText?.trim() || '<none>';
      throw new Error(`HTTP ${response.status}: ${statusText} (${url.hostname})`);
    }

    // 检查响应大小
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_SUBSCRIPTION_BYTES) {
      throw new Error(`响应过大: ${contentLength} 字节（限制 ${MAX_SUBSCRIPTION_BYTES}）`);
    }

    const text = await readResponseTextWithLimit(response, MAX_SUBSCRIPTION_BYTES, controller);

    return { text };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时（30秒）');
    }
    throw error;
  }
}

/**
 * 格式化订阅获取错误信息
 * 
 * @param rawUrl - 订阅 URL
 * @param error - 错误对象
 * @returns 格式化的错误信息
 */
function formatSubscriptionFetchError(rawUrl: string, error: unknown): string {
  const reason = formatError(error);
  return `拉取订阅失败 [${rawUrl}]: ${reason}`;
}
