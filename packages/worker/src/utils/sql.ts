/**
 * SQL 工具函数
 */

/**
 * 转义 SQL LIKE 模式中的特殊字符
 *
 * 防止用户输入的 % 和 _ 被误认为通配符
 *
 * @param pattern 原始搜索模式
 * @returns 转义后的模式
 *
 * @example
 * escapeLikePattern("50%_off") // => "50\\%\\_off"
 */
export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_\\]/g, '\\$&');
}

/**
 * 构建 LIKE 查询模式（自动添加通配符和转义）
 *
 * @param query 用户输入的搜索词
 * @param matchMode 匹配模式：'contains' | 'startsWith' | 'endsWith'
 * @returns 转义并添加通配符的模式
 *
 * @example
 * buildLikePattern("test", "contains") // => "%test%"
 * buildLikePattern("50%", "startsWith") // => "50\\%%"
 */
export function buildLikePattern(
  query: string,
  matchMode: 'contains' | 'startsWith' | 'endsWith' = 'contains'
): string {
  const escaped = escapeLikePattern(query);

  switch (matchMode) {
    case 'contains':
      return `%${escaped}%`;
    case 'startsWith':
      return `${escaped}%`;
    case 'endsWith':
      return `%${escaped}`;
  }
}
