/**
 * 错误处理工具函数
 */

export function getErrorStatusCode(error: unknown): number | null {
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== 'number' || !Number.isFinite(status)) {
    return null;
  }
  return status;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
