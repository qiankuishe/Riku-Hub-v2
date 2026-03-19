import { request } from './client';
import type { SubInfo } from './types';

export const subApi = {
  getInfo: () => request<SubInfo>('/api/sub/info')
};
