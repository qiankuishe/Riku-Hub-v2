import { SettingsRepository } from '../repositories/settings-repository';
import type { SettingsBackupPayload, SettingsDangerScope, SettingsExportStats } from '../types/settings';

const SETTINGS_DANGER_SCOPES: SettingsDangerScope[] = ['sources', 'navigation', 'notes', 'snippets', 'clipboard', 'all'];
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_ITEMS_PER_SECTION = 2_000;
const MAX_BACKUP_TOTAL_NAV_LINKS = 6_000;
const MAX_BACKUP_TEXT_LENGTH = 120_000;

export class SettingsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class SettingsService<TEnv> {
  constructor(private readonly repository: SettingsRepository<TEnv>) {}

  async listLogs(limitQuery: string | undefined): Promise<{ logs: Awaited<ReturnType<SettingsRepository<TEnv>['getLogs']>> }> {
    const limit = Number.parseInt(limitQuery || '50', 10);
    const logs = await this.repository.getLogs();
    return {
      logs: logs.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50)
    };
  }

  async getExportStats(): Promise<{ stats: SettingsExportStats }> {
    const stats = await this.repository.getSettingsExportStats();
    return { stats };
  }

  async exportBackup(): Promise<{
    backup: {
      version: string;
      exportedAt: string;
      stats: SettingsExportStats;
      sources: Awaited<ReturnType<SettingsRepository<TEnv>['getAllSources']>>;
      navigation: Awaited<ReturnType<SettingsRepository<TEnv>['getNavigationTree']>>;
      notes: Awaited<ReturnType<SettingsRepository<TEnv>['getAllNotes']>>;
      snippets: Awaited<ReturnType<SettingsRepository<TEnv>['getAllSnippets']>>;
      clipboard: Awaited<ReturnType<SettingsRepository<TEnv>['getAllClipboardItems']>>;
    };
  }> {
    const [sources, navigation, notes, snippets, clipboard, stats] = await Promise.all([
      this.repository.getAllSources(),
      this.repository.getNavigationTree(),
      this.repository.getAllNotes(),
      this.repository.getAllSnippets(),
      this.repository.getAllClipboardItems(),
      this.repository.getSettingsExportStats()
    ]);

    return {
      backup: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        stats,
        sources,
        navigation,
        notes,
        snippets,
        clipboard
      }
    };
  }

  async importBackup(input: { backup?: SettingsBackupPayload }): Promise<{
    success: true;
    message: string;
    imported: SettingsExportStats;
  }> {
    const backup = input.backup;
    if (!backup || typeof backup !== 'object') {
      throw new SettingsHttpError(400, '导入文件内容无效');
    }
    validateBackupPayload(backup);

    try {
      const imported = await this.repository.importSettingsBackup(backup);
      return {
        success: true,
        message: '导入完成，当前数据已替换',
        imported
      };
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number' ? Number((error as { status: number }).status) : 400;
      const normalizedStatus = status >= 400 && status < 500 ? status : 400;
      throw new SettingsHttpError(normalizedStatus, error instanceof Error ? error.message : '导入失败');
    }
  }

  async clearData(scopeValue: string): Promise<{ success: true; scope: SettingsDangerScope }> {
    const scope = scopeValue as SettingsDangerScope;
    if (!SETTINGS_DANGER_SCOPES.includes(scope)) {
      throw new SettingsHttpError(400, '清理范围无效');
    }

    await this.repository.clearSettingsScope(scope);
    return {
      success: true,
      scope
    };
  }
}

function validateBackupPayload(backup: SettingsBackupPayload): void {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(backup)).byteLength;
  if (payloadBytes > MAX_BACKUP_BYTES) {
    throw new SettingsHttpError(413, `导入文件过大，最大允许 ${MAX_BACKUP_BYTES} 字节`);
  }

  const sources = Array.isArray(backup.sources) ? backup.sources : [];
  const navigation = Array.isArray(backup.navigation) ? backup.navigation : Array.isArray(backup.categories) ? backup.categories : [];
  const notes = Array.isArray(backup.notes) ? backup.notes : [];
  const snippets = Array.isArray(backup.snippets) ? backup.snippets : [];
  const clipboard = Array.isArray(backup.clipboard) ? backup.clipboard : Array.isArray(backup.clipboard_items) ? backup.clipboard_items : [];

  if (sources.length > MAX_BACKUP_ITEMS_PER_SECTION) {
    throw new SettingsHttpError(400, `订阅源数量超过限制（${MAX_BACKUP_ITEMS_PER_SECTION}）`);
  }
  if (navigation.length > MAX_BACKUP_ITEMS_PER_SECTION) {
    throw new SettingsHttpError(400, `导航分类数量超过限制（${MAX_BACKUP_ITEMS_PER_SECTION}）`);
  }
  if (notes.length > MAX_BACKUP_ITEMS_PER_SECTION) {
    throw new SettingsHttpError(400, `笔记数量超过限制（${MAX_BACKUP_ITEMS_PER_SECTION}）`);
  }
  if (snippets.length > MAX_BACKUP_ITEMS_PER_SECTION) {
    throw new SettingsHttpError(400, `片段数量超过限制（${MAX_BACKUP_ITEMS_PER_SECTION}）`);
  }
  if (clipboard.length > MAX_BACKUP_ITEMS_PER_SECTION) {
    throw new SettingsHttpError(400, `剪贴板条目数量超过限制（${MAX_BACKUP_ITEMS_PER_SECTION}）`);
  }

  const totalNavLinks = navigation.reduce((sum, category) => sum + (Array.isArray(category?.links) ? category.links.length : 0), 0);
  if (totalNavLinks > MAX_BACKUP_TOTAL_NAV_LINKS) {
    throw new SettingsHttpError(400, `导航链接数量超过限制（${MAX_BACKUP_TOTAL_NAV_LINKS}）`);
  }

  for (const source of sources) {
    if (typeof source.content === 'string' && source.content.length > MAX_BACKUP_TEXT_LENGTH) {
      throw new SettingsHttpError(400, `订阅源内容超长，单条最大 ${MAX_BACKUP_TEXT_LENGTH} 字符`);
    }
  }
  for (const note of notes) {
    if (typeof note.content === 'string' && note.content.length > MAX_BACKUP_TEXT_LENGTH) {
      throw new SettingsHttpError(400, `笔记内容超长，单条最大 ${MAX_BACKUP_TEXT_LENGTH} 字符`);
    }
  }
  for (const snippet of snippets) {
    if (typeof snippet.content === 'string' && snippet.content.length > MAX_BACKUP_TEXT_LENGTH) {
      throw new SettingsHttpError(400, `片段内容超长，单条最大 ${MAX_BACKUP_TEXT_LENGTH} 字符`);
    }
  }
  for (const item of clipboard) {
    if (typeof item.content === 'string' && item.content.length > MAX_BACKUP_TEXT_LENGTH) {
      throw new SettingsHttpError(400, `剪贴板内容超长，单条最大 ${MAX_BACKUP_TEXT_LENGTH} 字符`);
    }
  }
}
