-- 为 sources.enabled 字段添加索引，优化查询性能
-- 这个索引将加速 "WHERE enabled = 1" 的查询

CREATE INDEX IF NOT EXISTS idx_sources_enabled_sort
  ON sources(enabled, sort_order);

-- 注释：
-- 1. enabled 字段在前，因为查询通常先过滤 enabled = 1
-- 2. sort_order 字段在后，用于排序
-- 3. 这个复合索引可以同时优化过滤和排序操作
