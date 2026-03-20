import type { LogRecord, SourceRecord } from '@riku-hub/shared';
import type { ClipboardItemRecord } from './clipboard';
import type { NavigationCategoryPayload } from './navigation';
import type { NoteRecord } from './notes';
import type { SnippetRecord } from './snippets';

export type SettingsDangerScope = 'sources' | 'navigation' | 'notes' | 'snippets' | 'clipboard' | 'all';

export interface SettingsExportStats {
  sources: number;
  navigationCategories: number;
  navigationLinks: number;
  notes: number;
  snippets: number;
  clipboardItems: number;
}

export type SettingsImportSkipReason = 'illegal_protocol' | 'unsafe_url';

export interface NavigationImportSkippedDetail {
  categoryName: string;
  linkTitle: string;
  url: string;
  reason: SettingsImportSkipReason;
}

export interface SettingsImportSkipped {
  navigation: {
    count: number;
    details: NavigationImportSkippedDetail[];
  };
}

export interface SettingsImportResult {
  imported: SettingsExportStats;
  skipped: SettingsImportSkipped;
}

export interface SettingsBackupPayload {
  version?: string;
  exportedAt?: string;
  sources?: SourceRecord[];
  navigation?: NavigationCategoryPayload[];
  categories?: NavigationCategoryPayload[];
  notes?: NoteRecord[];
  snippets?: SnippetRecord[];
  clipboard?: ClipboardItemRecord[];
  clipboard_items?: ClipboardItemRecord[];
}

export interface SettingsRepositoryDeps<TEnv> {
  getLogs: (env: TEnv) => Promise<LogRecord[]>;
  getSettingsExportStats: (env: TEnv) => Promise<SettingsExportStats>;
  getAllSources: (env: TEnv) => Promise<SourceRecord[]>;
  getNavigationTree: (env: TEnv) => Promise<NavigationCategoryPayload[]>;
  getAllNotes: (env: TEnv) => Promise<NoteRecord[]>;
  getAllSnippets: (env: TEnv) => Promise<SnippetRecord[]>;
  getAllClipboardItems: (env: TEnv) => Promise<ClipboardItemRecord[]>;
  importSettingsBackup: (env: TEnv, backup: SettingsBackupPayload) => Promise<SettingsImportResult>;
  clearSettingsScope: (env: TEnv, scope: SettingsDangerScope) => Promise<void>;
}
