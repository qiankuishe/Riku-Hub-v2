import { request } from './client';
import type { LogRecord } from './types';

export const logsApi = {
  getRecent: (limit = 50) => request<{ logs: LogRecord[] }>(`/api/logs?limit=${limit}`)
};
