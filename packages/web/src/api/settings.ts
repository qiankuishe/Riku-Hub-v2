import { request } from './client';
import type { SettingsBackupPayload, SettingsExportStats, SettingsImportSkipped } from './types';

export const settingsApi = {
  getExportStats: () => request<{ stats: SettingsExportStats }>('/api/settings/export/stats'),
  exportData: () => request<{ backup: SettingsBackupPayload }>('/api/settings/export'),
  importData: (backup: SettingsBackupPayload) =>
    request<{ success: boolean; message: string; imported: SettingsExportStats; skipped: SettingsImportSkipped }>('/api/settings/import', {
      method: 'POST',
      body: JSON.stringify({ backup })
    }),
  clearData: (scope: 'sources' | 'navigation' | 'notes' | 'snippets' | 'clipboard' | 'all') =>
    request<{ success: boolean; scope: string }>(`/api/settings/data/${scope}`, {
      method: 'DELETE'
    }),
  getSetting: (key: string) => request<{ value: string | null }>(`/api/settings/${key}`),
  setSetting: (key: string, value: string) =>
    request<{ success: boolean }>(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value })
    }),
  deleteSetting: (key: string) =>
    request<{ success: boolean }>(`/api/settings/${key}`, {
      method: 'DELETE'
    }),
  getAllSettings: () => request<{ settings: Record<string, string> }>('/api/settings')
};
