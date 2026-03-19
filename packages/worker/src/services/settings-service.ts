import { SettingsRepository } from '../repositories/settings-repository';
import type { SettingsBackupPayload, SettingsDangerScope, SettingsExportStats } from '../types/settings';

const SETTINGS_DANGER_SCOPES: SettingsDangerScope[] = ['sources', 'navigation', 'notes', 'snippets', 'clipboard', 'all'];

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

    try {
      const imported = await this.repository.importSettingsBackup(backup);
      return {
        success: true,
        message: '导入完成，当前数据已替换',
        imported
      };
    } catch (error) {
      throw new SettingsHttpError(400, error instanceof Error ? error.message : '导入失败');
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

