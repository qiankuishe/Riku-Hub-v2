import { SettingsRepository } from '../repositories/settings-repository';
import type { SettingsBackupPayload, SettingsDangerScope, SettingsExportStats, SettingsImportSkipped } from '../types/settings';

const SETTINGS_DANGER_SCOPES: SettingsDangerScope[] = ['sources', 'navigation', 'notes', 'snippets', 'clipboard', 'all'];

// 按类型分类的内容大小限制（字节）
// 遵循用户体验优先原则：限制应该宽松，避免功能障碍
const CONTENT_SIZE_LIMITS = {
  // 订阅源内容：10MB（兼容大型订阅源）
  source: 10 * 1024 * 1024,
  // 纯文本内容：5MB（支持长文档）
  text: 5 * 1024 * 1024,
  // 代码片段：1MB（支持完整代码文件）
  code: 1 * 1024 * 1024,
  // 图片内容：10MB（支持高清截图，base64 编码后约 7.5MB 原图）
  image: 10 * 1024 * 1024,
  // 链接数据：10KB（足够存储链接元数据）
  link: 10 * 1024
} as const;

// 数量限制
const MAX_BACKUP_BYTES = 100 * 1024 * 1024; // 总备份大小：100MB
const MAX_BACKUP_ITEMS_PER_SECTION = 2_000; // 每个分类的条目数
const MAX_BACKUP_TOTAL_NAV_LINKS = 10_000; // 导航链接总数（从 6000 提升到 10000，满足重度用户）

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
    skipped: SettingsImportSkipped;
  }> {
    const backup = input.backup;
    if (!backup || typeof backup !== 'object') {
      throw new SettingsHttpError(400, '导入文件内容无效');
    }
    validateBackupPayload(backup);

    try {
      const result = await this.repository.importSettingsBackup(backup);
      return {
        success: true,
        message: '导入完成，当前数据已替换',
        imported: result.imported,
        skipped: result.skipped
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
    throw new SettingsHttpError(413, `导入文件过大，最大允许 ${formatBytes(MAX_BACKUP_BYTES)}`);
  }

  const sources = Array.isArray(backup.sources) ? backup.sources : [];
  const navigation = Array.isArray(backup.navigation) ? backup.navigation : Array.isArray(backup.categories) ? backup.categories : [];
  const notes = Array.isArray(backup.notes) ? backup.notes : [];
  const snippets = Array.isArray(backup.snippets) ? backup.snippets : [];
  const clipboard = Array.isArray(backup.clipboard) ? backup.clipboard : Array.isArray(backup.clipboard_items) ? backup.clipboard_items : [];

  // 数量限制检查
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

  // 按类型检查内容大小（使用字节而不是字符长度）
  for (const source of sources) {
    if (typeof source.content === 'string') {
      const contentBytes = new TextEncoder().encode(source.content).byteLength;
      if (contentBytes > CONTENT_SIZE_LIMITS.source) {
        throw new SettingsHttpError(400, `订阅源内容过大，单条最大 ${formatBytes(CONTENT_SIZE_LIMITS.source)}（当前 ${formatBytes(contentBytes)}）`);
      }
    }
  }

  for (const note of notes) {
    if (typeof note.content === 'string') {
      const contentBytes = new TextEncoder().encode(note.content).byteLength;
      if (contentBytes > CONTENT_SIZE_LIMITS.text) {
        throw new SettingsHttpError(400, `笔记内容过大，单条最大 ${formatBytes(CONTENT_SIZE_LIMITS.text)}（当前 ${formatBytes(contentBytes)}）`);
      }
    }
  }

  for (const snippet of snippets) {
    if (typeof snippet.content === 'string') {
      const contentBytes = new TextEncoder().encode(snippet.content).byteLength;
      // 根据类型选择限制
      const limit =
        snippet.type === 'image'
          ? CONTENT_SIZE_LIMITS.image
          : snippet.type === 'code'
          ? CONTENT_SIZE_LIMITS.code
          : snippet.type === 'link'
          ? CONTENT_SIZE_LIMITS.link
          : CONTENT_SIZE_LIMITS.text;
      
      if (contentBytes > limit) {
        const typeName =
          snippet.type === 'image' ? '图片' : snippet.type === 'code' ? '代码' : snippet.type === 'link' ? '链接' : '文本';
        throw new SettingsHttpError(400, `${typeName}片段内容过大，单条最大 ${formatBytes(limit)}（当前 ${formatBytes(contentBytes)}）`);
      }
    }
  }

  for (const item of clipboard) {
    if (typeof item.content === 'string') {
      const contentBytes = new TextEncoder().encode(item.content).byteLength;
      // 根据类型选择限制
      const limit =
        item.type === 'image'
          ? CONTENT_SIZE_LIMITS.image
          : item.type === 'code'
          ? CONTENT_SIZE_LIMITS.code
          : item.type === 'link'
          ? CONTENT_SIZE_LIMITS.link
          : CONTENT_SIZE_LIMITS.text;
      
      if (contentBytes > limit) {
        const typeName =
          item.type === 'image' ? '图片' : item.type === 'code' ? '代码' : item.type === 'link' ? '链接' : '文本';
        throw new SettingsHttpError(400, `剪贴板${typeName}内容过大，单条最大 ${formatBytes(limit)}（当前 ${formatBytes(contentBytes)}）`);
      }
    }
  }
}

// 格式化字节大小为可读格式
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
