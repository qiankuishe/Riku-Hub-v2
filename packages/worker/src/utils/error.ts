/**
 * 错误处理工具函数
 */

// 敏感路径模式（不应暴露给客户端）
const SENSITIVE_PATTERNS = [
  /\/Users\/[^/]+/gi,          // macOS 用户路径
  /\/home\/[^/]+/gi,           // Linux 用户路径
  /C:\\Users\\[^\\]+/gi,       // Windows 用户路径
  /file:\/\/\/[^\s]+/gi,       // file:// 协议
  /at\s+[^(]+\([^)]+\)/g,      // 堆栈跟踪行
  /\s+at\s+.*/g,               // 完整堆栈跟踪
];

export function getErrorStatusCode(error: unknown): number | null {
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== 'number' || !Number.isFinite(status)) {
    return null;
  }
  return status;
}

/**
 * 格式化错误消息（清理敏感信息）
 *
 * 移除：
 * - 文件系统路径
 * - 堆栈跟踪
 * - 内部实现细节
 *
 * @param error 原始错误对象
 * @returns 清理后的错误消息
 */
export function formatError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);

  // 移除敏感路径和堆栈跟踪
  for (const pattern of SENSITIVE_PATTERNS) {
    message = message.replace(pattern, '[redacted]');
  }

  // 限制错误消息长度（防止长堆栈暴露）
  const MAX_ERROR_LENGTH = 200;
  if (message.length > MAX_ERROR_LENGTH) {
    message = message.substring(0, MAX_ERROR_LENGTH) + '...';
  }

  return message;
}

/**
 * 格式化错误用于日志记录（保留完整信息）
 *
 * 仅用于内部日志，不应发送给客户端
 *
 * @param error 原始错误对象
 * @returns 完整的错误信息（包含堆栈）
 */
export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}
