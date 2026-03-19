import { request } from './client';
import type { NoteRecord } from './types';

export const notesApi = {
  getAll: () => request<{ notes: NoteRecord[] }>('/api/notes'),
  create: (payload?: { title?: string; content?: string }) =>
    request<{ note: NoteRecord }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(payload ?? {})
    }),
  update: (id: string, payload: { title?: string; content?: string; isPinned?: boolean }) =>
    request<{ note: NoteRecord }>(`/api/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/notes/${id}`, {
      method: 'DELETE'
    })
};
