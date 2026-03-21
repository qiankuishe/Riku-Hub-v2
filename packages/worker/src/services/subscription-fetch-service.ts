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

import {
  expandSourceContent,
  resolveNodesFromInput
} from './subscription-parser-service';
import type { AggregateWarning, NormalizedNode } from '@riku-hub/shared';

// 类型定义
interface Env {
  CACHE_KV?: KVNamespace;
  APP_KV?: KVNamespace;
  DB?: D1Database;
}

// 重新导出共享函数，保持向后兼容
export { expandSourceContent, resolveNodesFromInput };
