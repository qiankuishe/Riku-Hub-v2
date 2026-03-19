import { request } from './client';
import type { SettingsBackupPayload, SettingsExportStats } from './types';

export const settingsApi = {
  getExportStats: () => request<{ stats: SettingsExportStats }>('/api/settings/export/stats'),
  exportData: () => request<{ backup: SettingsBackupPayload }>('/api/settings/export'),
  importData: (backup: SettingsBackupPayload) =>
    request<{ success: boolean; message: string; imported: SettingsExportStats }>('/api/settings/import', {
      method: 'POST',
      body: JSON.stringify({ backup })
    }),
  clearData: (scope: 'sources' | 'navigation' | 'notes' | 'snippets' | 'clipboard' | 'all') =>
    request<{ success: boolean; scope: string }>(`/api/settings/data/${scope}`, {
      method: 'DELETE'
    })
};
