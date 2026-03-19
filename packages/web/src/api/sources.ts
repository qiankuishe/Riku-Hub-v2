import { request } from './client';
import type { Source, ValidationResult } from './types';

export const sourcesApi = {
  getAll: () => request<{ sources: Source[]; lastSaveTime: string }>('/api/sources'),
  validate: (content: string) =>
    request<ValidationResult>('/api/sources/validate', {
      method: 'POST',
      body: JSON.stringify({ content })
    }),
  create: (name: string, content: string) =>
    request<{ source: Source; lastSaveTime: string }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ name, content })
    }),
  update: (id: string, data: { name?: string; content?: string; enabled?: boolean }) =>
    request<{ source: Source; lastSaveTime: string }>(`/api/sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  delete: (id: string) =>
    request<{ success: boolean; lastSaveTime: string }>(`/api/sources/${id}`, {
      method: 'DELETE'
    }),
  reorder: (ids: string[]) =>
    request<{ success: boolean; lastSaveTime: string }>('/api/sources/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids })
    }),
  refresh: () =>
    request<{ sources: Source[]; lastSaveTime: string }>('/api/sources/refresh', {
      method: 'POST'
    })
};
