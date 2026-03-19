import { request } from './client';
import type { PublicClipboardItem, SnippetRecord, SnippetType } from './types';

export const snippetsApi = {
  getAll: (params?: { type?: SnippetType | 'all'; q?: string }) => {
    const search = new URLSearchParams();
    if (params?.type && params.type !== 'all') {
      search.set('type', params.type);
    }
    if (params?.q?.trim()) {
      search.set('q', params.q.trim());
    }
    const query = search.toString();
    return request<{ snippets: SnippetRecord[] }>(`/api/snippets${query ? `?${query}` : ''}`);
  },
  create: (payload: { type: SnippetType; title?: string; content?: string }) =>
    request<{ snippet: SnippetRecord }>('/api/snippets', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  update: (id: string, payload: { type?: SnippetType; title?: string; content?: string; isPinned?: boolean; isLoginMapped?: boolean }) =>
    request<{ snippet: SnippetRecord }>(`/api/snippets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/snippets/${id}`, {
      method: 'DELETE'
    }),
  getPublicClipboard: () =>
    request<{ items: PublicClipboardItem[] }>('/api/clipboard/public', {
      skipAuthRedirect: true
    })
};
