/**
 * 应用限制配置
 *
 * 集中管理所有大小、数量、时间等限制值
 */

// 文件大小限制（字节）
export const FILE_SIZE_LIMITS = {
  /** 导入内容最大大小：10MB */
  MAX_CONTENT_SIZE: 10 * 1024 * 1024,

  /** 笔记内容最大大小：5MB */
  MAX_NOTE_CONTENT: 5 * 1024 * 1024,

  /** 代码片段内容最大大小：1MB */
  MAX_SNIPPET_CONTENT: 1 * 1024 * 1024,

  /** 图片代码片段最大大小：350KB */
  MAX_IMAGE_SNIPPET: 350 * 1024,

  /** Favicon 最大大小：64KB */
  MAX_FAVICON: 64 * 1024,

  /** 订阅源内容最大大小：5MB */
  MAX_SUBSCRIPTION: 5 * 1024 * 1024,
} as const;

// 并发和性能限制
export const CONCURRENCY_LIMITS = {
  /** 导入写入最大并发数 */
  MAX_IMPORT_WRITE_CONCURRENCY: 16,

  /** 订阅获取最大并发数 */
  MAX_SUBSCRIPTION_FETCH_CONCURRENCY: 8,

  /** DNS 缓存最大条目数 */
  DNS_CACHE_MAX_SIZE: 1000,
} as const;

// 时间限制（秒）
export const TIME_LIMITS = {
  /** Favicon 缓存时间：30 天 */
  FAVICON_CACHE_TTL: 30 * 24 * 60 * 60,

  /** DNS 缓存时间：5 分钟（毫秒） */
  DNS_CACHE_TTL_MS: 5 * 60 * 1000,

  /** 订阅聚合缓存默认时间 */
  DEFAULT_AGGREGATE_TTL: 3600,

  /** DNS 查询超时：4 秒（毫秒） */
  DNS_QUERY_TIMEOUT_MS: 4_000,

  /** 订阅获取超时：30 秒（毫秒） */
  SUBSCRIPTION_FETCH_TIMEOUT_MS: 30_000,
} as const;

// 数量限制
export const COUNT_LIMITS = {
  /** 最大日志条数 */
  DEFAULT_MAX_LOG_ENTRIES: 200,

  /** 最大重定向次数 */
  MAX_REDIRECTS: 3,

  /** 订阅嵌套最大深度 */
  MAX_SUBSCRIPTION_EXPANSION_DEPTH: 2,

  /** 每个订阅源最大 URL 数量 */
  MAX_SUBSCRIPTION_URLS_PER_SOURCE: 64,

  /** 最大解析警告数 */
  MAX_PARSE_WARNINGS: 200,

  /** 公开节点标签数量 */
  PUBLIC_NODE_LABELS_COUNT: 9,
} as const;

// 导出所有限制的合并对象（便于统一访问）
export const LIMITS = {
  ...FILE_SIZE_LIMITS,
  ...CONCURRENCY_LIMITS,
  ...TIME_LIMITS,
  ...COUNT_LIMITS,
} as const;

// 类型导出
export type LimitsConfig = typeof LIMITS;
