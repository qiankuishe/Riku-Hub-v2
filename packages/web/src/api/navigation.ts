import { request } from './client';
import type { NavigationCategory, NavigationLink } from './types';

export const navigationApi = {
  getAll: () =>
    request<{ categories: NavigationCategory[]; totalCategories: number; totalLinks: number }>('/api/navigation'),
  createCategory: (name: string) =>
    request<{ category: NavigationCategory }>('/api/navigation/categories', {
      method: 'POST',
      body: JSON.stringify({ name })
    }),
  updateCategory: (id: string, data: { name: string }) =>
    request<{ category: NavigationCategory }>(`/api/navigation/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteCategory: (id: string) =>
    request<{ success: boolean }>(`/api/navigation/categories/${id}`, {
      method: 'DELETE'
    }),
  reorderCategories: (ids: string[]) =>
    request<{ categories: NavigationCategory[] }>('/api/navigation/categories/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids })
    }),
  createLink: (payload: { categoryId: string; title: string; url: string; description?: string }) =>
    request<{ link: NavigationLink }>('/api/navigation/links', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateLink: (id: string, payload: { categoryId?: string; title?: string; url?: string; description?: string }) =>
    request<{ link: NavigationLink }>(`/api/navigation/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  deleteLink: (id: string) =>
    request<{ success: boolean }>(`/api/navigation/links/${id}`, {
      method: 'DELETE'
    }),
  recordVisit: (id: string) =>
    request<{ visitCount: number; lastVisitedAt: string | null }>(`/api/navigation/links/${id}/visit`, {
      method: 'POST'
    }),
  reorderLinks: (categoryId: string, ids: string[]) =>
    request<{ links: NavigationLink[] }>('/api/navigation/links/reorder', {
      method: 'PUT',
      body: JSON.stringify({ categoryId, ids })
    })
};
