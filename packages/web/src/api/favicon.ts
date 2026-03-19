import { request } from './client';

export const faviconApi = {
  get: (url: string) =>
    request<{ dataUrl: string; cached: boolean }>(`/api/favicon?url=${encodeURIComponent(url)}`)
};
