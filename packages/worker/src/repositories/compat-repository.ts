import { NAVIGATION_SEED } from '../navigation-seed';
import { formatBytes } from '../utils/compat';
import { randomToken } from '../utils/runtime';
import type {
  CompatAuthUserDTO,
  CompatBindings,
  CompatClipboardItemRecord,
  CompatClipboardItemType,
  CompatSessionRecord,
  CompatSettingsStatsDTO
} from '../types/compat';

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const STORAGE_LIMIT = '100 MB';

const APP_KEYS = {
  navigationSeeded: 'config:navigation-seeded',
  sourceIndex: 'source:index',
  navCategoryIndex: 'nav:category:index',
  noteIndex: 'note:index',
  snippetIndex: 'snippet:index',
  clipboardIndex: 'clipboard:index',
  settingsStore: 'settings:store'
} as const;

export class CompatRepository {
  constructor(private readonly env: CompatBindings) {}

  async createSession(username: string): Promise<CompatSessionRecord> {
    const token = randomToken();
    const createdAt = Date.now();
    const effectiveUsername = (this.env.ADMIN_USERNAME ?? username).trim() || 'admin';
    const session: CompatSessionRecord = {
      token,
      username: effectiveUsername,
      createdAt,
      expiresAt: createdAt + SESSION_TTL_SECONDS * 1000,
      passwordHash: this.env.ADMIN_PASSWORD_HASH ?? ''
    };

    const db = this.getDb();
    if (db) {
      await db.prepare(
        'INSERT INTO auth_sessions (token, username, created_at, expires_at, password_hash) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(session.token, session.username, session.createdAt, session.expiresAt, session.passwordHash)
        .run();
    } else {
      await this.env.APP_KV.put(
        this.sessionKey(token),
        JSON.stringify({
          username: session.username,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          passwordHash: session.passwordHash
        })
      );
    }

    return session;
  }

  async getSession(token: string): Promise<CompatSessionRecord | null> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare(
        'SELECT token, username, created_at, expires_at, password_hash FROM auth_sessions WHERE token = ?'
      )
        .bind(token)
        .first<{
          token: string;
          username: string;
          created_at: number;
          expires_at: number;
          password_hash: string;
        }>();

      if (!row) {
        return null;
      }
      if (row.expires_at <= Date.now()) {
        await this.deleteSession(token);
        return null;
      }

      const expectedHash = this.env.ADMIN_PASSWORD_HASH ?? '';
      const sessionHash = row.password_hash ?? '';
      if (expectedHash && sessionHash !== expectedHash) {
        await this.deleteSession(token);
        return null;
      }

      return {
        token: row.token,
        username: row.username,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        passwordHash: row.password_hash ?? ''
      };
    }

    const raw = await this.env.APP_KV.get(this.sessionKey(token), 'json');
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const session = raw as Partial<CompatSessionRecord>;
    if (typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) {
      await this.deleteSession(token);
      return null;
    }

    const expectedHash = this.env.ADMIN_PASSWORD_HASH ?? '';
    const sessionHash = typeof session.passwordHash === 'string' ? session.passwordHash : '';
    if (expectedHash && sessionHash !== expectedHash) {
      await this.deleteSession(token);
      return null;
    }

    return {
      token,
      username: typeof session.username === 'string' ? session.username : '',
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
      expiresAt: session.expiresAt,
      passwordHash: typeof session.passwordHash === 'string' ? session.passwordHash : ''
    };
  }

  async deleteSession(token: string): Promise<void> {
    const db = this.getDb();
    if (db) {
      await db.prepare('DELETE FROM auth_sessions WHERE token = ?').bind(token).run();
      return;
    }

    await this.env.APP_KV.delete(this.sessionKey(token));
  }

  async saveAuthProfile(token: string, user: CompatAuthUserDTO): Promise<CompatAuthUserDTO> {
    await this.setAppMetaValue(this.authProfileKey(token), JSON.stringify(user));
    return user;
  }

  async getAuthProfile(token: string): Promise<CompatAuthUserDTO | null> {
    const raw = await this.getAppMetaValue(this.authProfileKey(token));
    if (!raw) {
      return null;
    }

    try {
      const user = JSON.parse(raw) as Partial<CompatAuthUserDTO>;
      if (
        user &&
        typeof user === 'object' &&
        typeof user.id === 'number' &&
        typeof user.email === 'string' &&
        typeof user.username === 'string' &&
        typeof user.created_at === 'string'
      ) {
        return {
          id: user.id,
          email: user.email,
          username: user.username,
          avatar_url: typeof user.avatar_url === 'string' || user.avatar_url === null ? user.avatar_url : null,
          created_at: user.created_at
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  async getClipboardItem(id: string): Promise<CompatClipboardItemRecord | null> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare(
        'SELECT id, type, content, tags, is_pinned, created_at, updated_at FROM clipboard_items WHERE id = ?'
      )
        .bind(id)
        .first<ClipboardItemRow>();
      return row ? mapClipboardItemRow(row) : null;
    }

    const raw = await this.env.APP_KV.get(`clipboard:${id}`, 'json');
    return normalizeClipboardRecord(raw, id);
  }

  async getClipboardItems(): Promise<CompatClipboardItemRecord[]> {
    const db = this.getDb();
    if (db) {
      const result = await db.prepare(
        'SELECT id, type, content, tags, is_pinned, created_at, updated_at FROM clipboard_items ORDER BY is_pinned DESC, updated_at DESC'
      ).all<ClipboardItemRow>();
      return (result.results ?? []).map(mapClipboardItemRow);
    }

    const ids = await this.getClipboardIndex();
    const items = await Promise.all(ids.map((id) => this.getClipboardItem(id)));
    return items
      .filter((item): item is CompatClipboardItemRecord => Boolean(item))
      .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.updatedAt.localeCompare(left.updatedAt));
  }

  async saveClipboardItem(item: CompatClipboardItemRecord): Promise<CompatClipboardItemRecord> {
    const db = this.getDb();
    if (db) {
      await db.prepare(
        `INSERT INTO clipboard_items (id, type, content, tags, is_pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           content = excluded.content,
           tags = excluded.tags,
           is_pinned = excluded.is_pinned,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
        .bind(
          item.id,
          item.type,
          item.content,
          JSON.stringify(item.tags ?? []),
          Number(item.isPinned),
          item.createdAt,
          item.updatedAt
        )
        .run();
      return item;
    }

    await this.env.APP_KV.put(`clipboard:${item.id}`, JSON.stringify(item));
    const ids = await this.getClipboardIndex();
    if (!ids.includes(item.id)) {
      await this.saveClipboardIndex([...ids, item.id]);
    }
    return item;
  }

  async deleteClipboardItem(id: string): Promise<void> {
    const db = this.getDb();
    if (db) {
      await db.prepare('DELETE FROM clipboard_items WHERE id = ?').bind(id).run();
      return;
    }

    const ids = await this.getClipboardIndex();
    await this.env.APP_KV.delete(`clipboard:${id}`);
    await this.saveClipboardIndex(ids.filter((value) => value !== id));
  }

  async getSettingsValues(): Promise<Record<string, unknown>> {
    const defaults: Record<string, unknown> = {
      theme: 'light',
      language: 'zh-CN',
      auto_sync: true,
      notification_enabled: true
    };

    const stored = await this.readStoredSettings();
    return { ...defaults, ...stored };
  }

  async updateSettingsValues(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    const current = await this.readStoredSettings();
    const next = { ...current, ...values };
    await this.writeStoredSettings(next);
    return this.getSettingsValues();
  }

  async getSettingsStats(): Promise<CompatSettingsStatsDTO> {
    const [categories, links, sources, notes, snippets, clipboardItems] = await Promise.all([
      this.countNavigationCategories(),
      this.countNavigationLinks(),
      this.countSources(),
      this.countNotes(),
      this.countSnippets(),
      this.getClipboardItems()
    ]);

    const storageBytes = new TextEncoder()
      .encode(
        JSON.stringify({
          categories,
          links,
          sources,
          notes,
          snippets,
          clipboardItems
        })
      )
      .byteLength;

    return {
      categories,
      links,
      sources,
      articles: 0,
      notes,
      clipboard_items: clipboardItems.length,
      storage_used: formatBytes(storageBytes),
      storage_limit: STORAGE_LIMIT
    };
  }

  private async countNavigationCategories(): Promise<number> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare('SELECT COUNT(*) AS count FROM navigation_categories').first<{ count: number }>();
      return Number(row?.count ?? 0);
    }

    const ids = await this.getNavigationCategoryIndex();
    return ids.length || NAVIGATION_SEED.length;
  }

  private async countNavigationLinks(): Promise<number> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare('SELECT COUNT(*) AS count FROM navigation_links').first<{ count: number }>();
      return Number(row?.count ?? 0);
    }

    const categoryIds = await this.getNavigationCategoryIndex();
    const linkIndexes = await Promise.all(categoryIds.map((categoryId) => this.getNavigationLinkIndex(categoryId)));
    const count = linkIndexes.reduce((sum, ids) => sum + ids.length, 0);
    return count || NAVIGATION_SEED.reduce((sum, category) => sum + category.links.length, 0);
  }

  private async countSources(): Promise<number> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare('SELECT COUNT(*) AS count FROM sources').first<{ count: number }>();
      return Number(row?.count ?? 0);
    }

    return (await this.getIndexArray(APP_KEYS.sourceIndex)).length;
  }

  private async countNotes(): Promise<number> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare('SELECT COUNT(*) AS count FROM notes').first<{ count: number }>();
      return Number(row?.count ?? 0);
    }

    return (await this.getIndexArray(APP_KEYS.noteIndex)).length;
  }

  private async countSnippets(): Promise<number> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare('SELECT COUNT(*) AS count FROM snippets').first<{ count: number }>();
      return Number(row?.count ?? 0);
    }

    return (await this.getIndexArray(APP_KEYS.snippetIndex)).length;
  }

  private async getClipboardIndex(): Promise<string[]> {
    const db = this.getDb();
    if (db) {
      const result = await db.prepare('SELECT id FROM clipboard_items ORDER BY created_at ASC').all<{ id: string }>();
      return (result.results ?? []).map((row: { id: string }) => row.id);
    }

    return this.getIndexArray(APP_KEYS.clipboardIndex);
  }

  private async saveClipboardIndex(ids: string[]): Promise<void> {
    if (this.getDb()) {
      return;
    }

    await this.env.APP_KV.put(APP_KEYS.clipboardIndex, JSON.stringify(ids));
  }

  private async getNavigationCategoryIndex(): Promise<string[]> {
    return this.getIndexArray(APP_KEYS.navCategoryIndex);
  }

  private async getNavigationLinkIndex(categoryId: string): Promise<string[]> {
    return this.getIndexArray(`nav:link:index:${categoryId}`);
  }

  private async readStoredSettings(): Promise<Record<string, unknown>> {
    const db = this.getDb();
    if (db) {
      const rows = await db.prepare('SELECT key, value, updated_at FROM settings').all<SettingsRow>();
      const settings: Record<string, unknown> = {};
      for (const row of rows.results ?? []) {
        settings[row.key] = parseSettingValue(row.value);
      }
      return settings;
    }

    const raw = await this.env.APP_KV.get(APP_KEYS.settingsStore, 'json');
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }

  private async writeStoredSettings(values: Record<string, unknown>): Promise<void> {
    const db = this.getDb();
    if (db) {
      const now = new Date().toISOString();
      await Promise.all(
        Object.entries(values).map(([key, value]) =>
          db.prepare(
            `INSERT INTO settings (key, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`
          )
            .bind(key, JSON.stringify(value), now)
            .run()
        )
      );
      return;
    }

    await this.env.APP_KV.put(APP_KEYS.settingsStore, JSON.stringify(values));
  }

  private async getAppMetaValue(key: string): Promise<string | null> {
    const db = this.getDb();
    if (db) {
      const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(key).first<{ value: string }>();
      return row?.value ?? null;
    }

    return this.env.APP_KV.get(`meta:${key}`);
  }

  private async setAppMetaValue(key: string, value: string): Promise<void> {
    const db = this.getDb();
    if (db) {
      await db.prepare(
        `INSERT INTO app_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`
      )
        .bind(key, value, new Date().toISOString())
        .run();
      return;
    }

    await this.env.APP_KV.put(`meta:${key}`, value);
  }

  private authProfileKey(token: string): string {
    return `auth:profile:${token}`;
  }

  private sessionKey(token: string): string {
    return `session:${token}`;
  }

  private getDb(): D1Database | null {
    return this.env.DB ?? null;
  }

  private async getIndexArray(key: string): Promise<string[]> {
    const ids = await this.env.APP_KV.get(key, 'json');
    return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
  }
}

interface ClipboardItemRow {
  id: string;
  type: CompatClipboardItemType;
  content: string;
  tags: string | null;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

function mapClipboardItemRow(row: ClipboardItemRow): CompatClipboardItemRecord {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    tags: parseTags(row.tags),
    isPinned: row.is_pinned > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeClipboardRecord(raw: unknown, fallbackId: string): CompatClipboardItemRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Partial<CompatClipboardItemRecord> & { is_pinned?: boolean };
  const type =
    item.type === 'code' || item.type === 'link' || item.type === 'image' ? item.type : item.type === 'text' ? 'text' : null;
  if (!type || typeof item.content !== 'string') {
    return null;
  }

  return {
    id: typeof item.id === 'string' && item.id ? item.id : fallbackId,
    type,
    content: item.content,
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    isPinned: typeof item.isPinned === 'boolean' ? item.isPinned : Boolean(item.is_pinned),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date(0).toISOString()
  };
}

function parseTags(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => String(tag).trim()).filter(Boolean);
    }
  } catch {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function parseSettingValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
