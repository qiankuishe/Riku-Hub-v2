import type { LogRecord, SourceRecord } from '@riku-hub/shared';
import type { ClipboardItemRecord } from '../types/clipboard';
import type { NavigationCategoryPayload } from '../types/navigation';
import type { NoteRecord } from '../types/notes';
import type {
  SettingsBackupPayload,
  SettingsDangerScope,
  SettingsExportStats,
  SettingsImportResult,
  SettingsRepositoryDeps
} from '../types/settings';
import type { SnippetRecord } from '../types/snippets';

export class SettingsRepository<TEnv> {
  constructor(
    private readonly env: TEnv,
    private readonly deps: SettingsRepositoryDeps<TEnv>
  ) {}

  getLogs(): Promise<LogRecord[]> {
    return this.deps.getLogs(this.env);
  }

  getSettingsExportStats(): Promise<SettingsExportStats> {
    return this.deps.getSettingsExportStats(this.env);
  }

  getAllSources(): Promise<SourceRecord[]> {
    return this.deps.getAllSources(this.env);
  }

  getNavigationTree(): Promise<NavigationCategoryPayload[]> {
    return this.deps.getNavigationTree(this.env);
  }

  getAllNotes(): Promise<NoteRecord[]> {
    return this.deps.getAllNotes(this.env);
  }

  getAllSnippets(): Promise<SnippetRecord[]> {
    return this.deps.getAllSnippets(this.env);
  }

  getAllClipboardItems(): Promise<ClipboardItemRecord[]> {
    return this.deps.getAllClipboardItems(this.env);
  }

  importSettingsBackup(backup: SettingsBackupPayload): Promise<SettingsImportResult> {
    return this.deps.importSettingsBackup(this.env, backup);
  }

  clearSettingsScope(scope: SettingsDangerScope): Promise<void> {
    return this.deps.clearSettingsScope(this.env, scope);
  }
}
