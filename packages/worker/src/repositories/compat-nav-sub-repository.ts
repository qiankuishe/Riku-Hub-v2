import { NAVIGATION_SEED } from '../navigation-seed';
import {
  getAggregateTtlSeconds as getAggregateTtlSecondsFromEnv,
  getMaxLogEntries as getMaxLogEntriesFromEnv
} from '../utils/runtime';
import type {
  AggregateMeta,
  CachedFormatPayload,
  CachedNodesPayload,
  LogRecord,
  OutputFormat,
  SourceRecord
} from '@riku-hub/shared';
import type {
  CompatNavSubBindings,
  CompatNavigationCategoryPayload,
  CompatNavigationCategoryRecord,
  CompatNavigationLinkRecord
} from '../types/compat-nav-sub';

const APP_KEYS = {
  subToken: 'config:sub-token',
  aggregateMeta: 'config:aggregate-meta',
  navigationSeeded: 'config:navigation-seeded',
  sourceIndex: 'source:index',
  logsRecent: 'logs:recent',
  navCategoryIndex: 'nav:category:index'
} as const;

const CACHE_KEYS = {
  nodes: 'cache:nodes',
  format: (format: OutputFormat) => `cache:format:${format}`
} as const;

export class CompatNavSubRepository {
  constructor(private readonly env: CompatNavSubBindings) {}

  /** 获取环境绑定对象，用于共享服务 */
  getEnv(): CompatNavSubBindings {
    return this.env;
  }

  async getNavigationTree(): Promise<CompatNavigationCategoryPayload[]> {
    await this.ensureNavigationSeeded();
    const categories = await this.getNavigationCategories();
    return Promise.all(
      categories.map(async (category) => ({
        ...category,
        links: await this.getNavigationLinksByCategory(category.id)
      }))
    );
  }

  async getNavigationCategory(id: string): Promise<CompatNavigationCategoryRecord | null> {
    if (this.hasD1()) {
      const row = await this.getDb()
        .prepare('SELECT id, name, sort_order, created_at, updated_at FROM navigation_categories WHERE id = ?')
        .bind(id)
        .first<NavigationCategoryRow>();
      return row ? mapNavigationCategoryRow(row) : null;
    }

    const category = await this.env.APP_KV.get(`nav:category:${id}`, 'json');
    return category as CompatNavigationCategoryRecord | null;
  }

  async getNavigationCategories(): Promise<CompatNavigationCategoryRecord[]> {
    await this.ensureNavigationSeeded();
    if (this.hasD1()) {
      const result = await this.getDb()
        .prepare('SELECT id, name, sort_order, created_at, updated_at FROM navigation_categories ORDER BY sort_order ASC')
        .all<NavigationCategoryRow>();
      return (result.results ?? []).map(mapNavigationCategoryRow);
    }

    const ids = await this.getNavigationCategoryIndex();
    const categories = await Promise.all(ids.map((id) => this.getNavigationCategory(id)));
    return categories
      .filter((category): category is CompatNavigationCategoryRecord => Boolean(category))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createNavigationCategory(name: string): Promise<CompatNavigationCategoryRecord> {
    await this.ensureNavigationSeeded();
    const categories = await this.getNavigationCategories();
    const now = new Date().toISOString();
    const category: CompatNavigationCategoryRecord = {
      id: randomToken(8),
      name,
      sortOrder: categories.length,
      createdAt: now,
      updatedAt: now
    };

    await this.saveNavigationCategory(category);
    if (this.hasD1()) {
      return category;
    }

    const ids = await this.getNavigationCategoryIndex();
    await this.saveNavigationCategoryIndex([...ids, category.id]);
    await this.saveNavigationLinkIndex(category.id, []);
    return category;
  }

  async reorderNavigationCategories(ids: string[]): Promise<CompatNavigationCategoryRecord[]> {
    const now = new Date().toISOString();
    if (!this.hasD1()) {
      await this.saveNavigationCategoryIndex(ids);
    }

    const categories = await Promise.all(
      ids.map(async (id, index) => {
        const category = await this.getNavigationCategory(id);
        if (!category) {
          return null;
        }
        return this.saveNavigationCategory({
          ...category,
          sortOrder: index,
          updatedAt: now
        });
      })
    );

    return categories.filter((category): category is CompatNavigationCategoryRecord => Boolean(category));
  }

  async updateNavigationCategory(categoryId: string, updates: Pick<CompatNavigationCategoryRecord, 'name'>): Promise<CompatNavigationCategoryRecord | null> {
    const category = await this.getNavigationCategory(categoryId);
    if (!category) {
      return null;
    }

    return this.saveNavigationCategory({
      ...category,
      name: updates.name,
      updatedAt: new Date().toISOString()
    });
  }

  async deleteNavigationCategory(categoryId: string): Promise<void> {
    if (this.hasD1()) {
      await this.getDb().prepare('DELETE FROM navigation_categories WHERE id = ?').bind(categoryId).run();
      return;
    }

    const linkIds = await this.getNavigationLinkIndex(categoryId);
    await Promise.all(linkIds.map((id) => this.env.APP_KV.delete(`nav:link:${id}`)));
    await this.env.APP_KV.delete(`nav:link:index:${categoryId}`);
    await this.env.APP_KV.delete(`nav:category:${categoryId}`);

    const nextIds = (await this.getNavigationCategoryIndex()).filter((id) => id !== categoryId);
    await this.reorderNavigationCategories(nextIds);
  }

  async getNavigationLink(id: string): Promise<CompatNavigationLinkRecord | null> {
    if (this.hasD1()) {
      const row = await this.getDb()
        .prepare(
          `SELECT id, category_id, title, url, description, sort_order, visit_count, last_visited_at, created_at, updated_at
           FROM navigation_links
           WHERE id = ?`
        )
        .bind(id)
        .first<NavigationLinkRow>();
      return row ? mapNavigationLinkRow(row) : null;
    }

    const link = await this.env.APP_KV.get(`nav:link:${id}`, 'json');
    if (!link) {
      return null;
    }

    const record = link as Partial<CompatNavigationLinkRecord>;
    return {
      id: record.id ?? id,
      categoryId: record.categoryId ?? '',
      title: record.title ?? '',
      url: record.url ?? '',
      description: record.description ?? '',
      sortOrder: record.sortOrder ?? 0,
      visitCount: record.visitCount ?? 0,
      lastVisitedAt: record.lastVisitedAt ?? null,
      createdAt: record.createdAt ?? new Date(0).toISOString(),
      updatedAt: record.updatedAt ?? new Date(0).toISOString()
    };
  }

  async getNavigationLinksByCategory(categoryId: string): Promise<CompatNavigationLinkRecord[]> {
    if (this.hasD1()) {
      const result = await this.getDb()
        .prepare(
          `SELECT id, category_id, title, url, description, sort_order, visit_count, last_visited_at, created_at, updated_at
           FROM navigation_links
           WHERE category_id = ?
           ORDER BY sort_order ASC`
        )
        .bind(categoryId)
        .all<NavigationLinkRow>();
      return (result.results ?? []).map(mapNavigationLinkRow);
    }

    const ids = await this.getNavigationLinkIndex(categoryId);
    const links = await Promise.all(ids.map((id) => this.getNavigationLink(id)));
    return links
      .filter((link): link is CompatNavigationLinkRecord => Boolean(link))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createNavigationLink(
    payload: Pick<CompatNavigationLinkRecord, 'categoryId' | 'title' | 'url' | 'description'>
  ): Promise<CompatNavigationLinkRecord> {
    const links = await this.getNavigationLinksByCategory(payload.categoryId);
    const now = new Date().toISOString();
    const link: CompatNavigationLinkRecord = {
      id: randomToken(8),
      categoryId: payload.categoryId,
      title: payload.title,
      url: payload.url,
      description: payload.description,
      sortOrder: links.length,
      visitCount: 0,
      lastVisitedAt: null,
      createdAt: now,
      updatedAt: now
    };

    await this.saveNavigationLink(link);
    if (this.hasD1()) {
      return link;
    }

    const ids = await this.getNavigationLinkIndex(payload.categoryId);
    await this.saveNavigationLinkIndex(payload.categoryId, [...ids, link.id]);
    return link;
  }

  async reorderNavigationLinks(categoryId: string, ids: string[]): Promise<CompatNavigationLinkRecord[]> {
    if (!this.hasD1()) {
      await this.saveNavigationLinkIndex(categoryId, ids);
    }

    const now = new Date().toISOString();
    const links = await Promise.all(
      ids.map(async (id, index) => {
        const link = await this.getNavigationLink(id);
        if (!link) {
          return null;
        }
        return this.saveNavigationLink({
          ...link,
          categoryId,
          sortOrder: index,
          updatedAt: now
        });
      })
    );

    return links.filter((link): link is CompatNavigationLinkRecord => Boolean(link));
  }

  async updateNavigationLink(
    link: CompatNavigationLinkRecord,
    payload: Pick<CompatNavigationLinkRecord, 'categoryId' | 'title' | 'url' | 'description'>
  ): Promise<CompatNavigationLinkRecord> {
    const now = new Date().toISOString();
    if (payload.categoryId === link.categoryId) {
      return this.saveNavigationLink({
        ...link,
        title: payload.title,
        url: payload.url,
        description: payload.description,
        updatedAt: now
      });
    }

    const sourceIds = (await this.getNavigationLinkIndex(link.categoryId)).filter((id) => id !== link.id);
    await this.reorderNavigationLinks(link.categoryId, sourceIds);

    const targetIds = await this.getNavigationLinkIndex(payload.categoryId);
    const updated: CompatNavigationLinkRecord = {
      ...link,
      categoryId: payload.categoryId,
      title: payload.title,
      url: payload.url,
      description: payload.description,
      sortOrder: targetIds.length,
      updatedAt: now
    };

    await this.saveNavigationLink(updated);
    await this.saveNavigationLinkIndex(payload.categoryId, [...targetIds, updated.id]);
    return updated;
  }

  async deleteNavigationLink(linkId: string, categoryId: string): Promise<void> {
    if (this.hasD1()) {
      await this.getDb().prepare('DELETE FROM navigation_links WHERE id = ?').bind(linkId).run();
      return;
    }

    await this.env.APP_KV.delete(`nav:link:${linkId}`);
    const nextIds = (await this.getNavigationLinkIndex(categoryId)).filter((id) => id !== linkId);
    await this.reorderNavigationLinks(categoryId, nextIds);
  }

  async recordNavigationLinkVisit(link: CompatNavigationLinkRecord): Promise<CompatNavigationLinkRecord> {
    const updated: CompatNavigationLinkRecord = {
      ...link,
      visitCount: (link.visitCount ?? 0) + 1,
      lastVisitedAt: new Date().toISOString()
    };
    return this.saveNavigationLink(updated);
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    if (this.hasD1()) {
      const row = await this.getDb()
        .prepare('SELECT id, name, content, node_count, sort_order, enabled, created_at, updated_at FROM sources WHERE id = ?')
        .bind(id)
        .first<SourceRow>();
      return row ? mapSourceRow(row) : null;
    }

    const source = await this.env.APP_KV.get(`source:${id}`, 'json');
    return source as SourceRecord | null;
  }

  async getAllSources(): Promise<SourceRecord[]> {
    const ids = await this.getSourceIndex();
    const records = await Promise.all(ids.map((id) => this.getSource(id)));
    return records.filter((record): record is SourceRecord => Boolean(record)).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createSource(name: string, content: string, nodeCount: number): Promise<SourceRecord> {
    const ids = await this.getSourceIndex();
    const now = new Date().toISOString();
    const source: SourceRecord = {
      id: randomToken(8),
      name,
      content,
      nodeCount,
      sortOrder: ids.length,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
    await this.saveSource(source);
    await this.saveSourceIndex([...ids, source.id]);
    return source;
  }

  async saveSource(source: SourceRecord): Promise<SourceRecord> {
    if (this.hasD1()) {
      await this.getDb()
        .prepare(
          `INSERT INTO sources (id, name, content, node_count, sort_order, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             content = excluded.content,
             node_count = excluded.node_count,
             sort_order = excluded.sort_order,
             enabled = excluded.enabled,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at`
        )
        .bind(source.id, source.name, source.content, source.nodeCount, source.sortOrder, source.enabled ? 1 : 0, source.createdAt, source.updatedAt)
        .run();
      return source;
    }

    await this.env.APP_KV.put(`source:${source.id}`, JSON.stringify(source));
    return source;
  }

  async deleteSource(id: string): Promise<void> {
    if (this.hasD1()) {
      await this.getDb().prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
      return;
    }

    const ids = await this.getSourceIndex();
    await this.env.APP_KV.delete(`source:${id}`);
    await this.saveSourceIndex(ids.filter((value) => value !== id));
  }

  async getSubToken(): Promise<string> {
    if (this.env.SUB_TOKEN) {
      return this.env.SUB_TOKEN;
    }

    const existing = await this.getAppMetaValue(APP_KEYS.subToken);
    if (existing) {
      return existing;
    }

    const created = randomToken(32);
    await this.setAppMetaValue(APP_KEYS.subToken, created);
    return created;
  }

  async getAggregateMeta(): Promise<AggregateMeta> {
    const raw = await this.getAppMetaValue(APP_KEYS.aggregateMeta);
    if (raw) {
      try {
        const meta = JSON.parse(raw) as AggregateMeta;
        if (meta && typeof meta === 'object') {
          return meta;
        }
      } catch {
        // ignore malformed meta and fall back to defaults
      }
    }

    return {
      cacheStatus: 'missing',
      totalNodes: 0,
      warningCount: 0,
      lastRefreshTime: '',
      lastRefreshError: ''
    };
  }

  async saveAggregateMeta(meta: AggregateMeta): Promise<AggregateMeta> {
    await this.setAppMetaValue(APP_KEYS.aggregateMeta, JSON.stringify(meta));
    return meta;
  }

  async getCachedNodes(): Promise<CachedNodesPayload | null> {
    return this.env.CACHE_KV.get(CACHE_KEYS.nodes, 'json');
  }

  async getCachedFormat(format: OutputFormat): Promise<CachedFormatPayload | null> {
    return this.env.CACHE_KV.get(CACHE_KEYS.format(format), 'json');
  }

  async saveCachedNodes(payload: CachedNodesPayload): Promise<void> {
    await this.env.CACHE_KV.put(CACHE_KEYS.nodes, JSON.stringify(payload));
  }

  async saveCachedFormat(format: OutputFormat, payload: CachedFormatPayload): Promise<void> {
    await this.env.CACHE_KV.put(CACHE_KEYS.format(format), JSON.stringify(payload));
  }

  async invalidateCache(): Promise<void> {
    const formats: OutputFormat[] = ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'];
    await Promise.all([this.env.CACHE_KV.delete(CACHE_KEYS.nodes), ...formats.map((format) => this.env.CACHE_KV.delete(CACHE_KEYS.format(format)))]);
    await this.saveAggregateMeta({
      cacheStatus: 'missing',
      totalNodes: 0,
      warningCount: 0,
      lastRefreshTime: '',
      lastRefreshError: ''
    });
  }

  async getCachedDns(hostname: string, type: 'A' | 'AAAA'): Promise<string[] | null> {
    return this.env.CACHE_KV.get(`dns:${hostname}:${type}`, 'json');
  }

  async saveCachedDns(hostname: string, type: 'A' | 'AAAA', records: string[]): Promise<void> {
    await this.env.CACHE_KV.put(`dns:${hostname}:${type}`, JSON.stringify(records), { expirationTtl: 300 });
  }

  getAggregateTtlSeconds(): number {
    return getAggregateTtlSecondsFromEnv(this.env);
  }

  async appendLog(action: string, detail?: string): Promise<void> {
    try {
      if (this.hasD1()) {
        await this.getDb()
          .prepare('INSERT INTO app_logs (id, action, detail, created_at) VALUES (?, ?, ?, ?)')
          .bind(randomToken(6), action, detail ?? null, new Date().toISOString())
          .run();
        await this.getDb()
          .prepare(
            `DELETE FROM app_logs
             WHERE id NOT IN (
               SELECT id FROM app_logs ORDER BY created_at DESC LIMIT ?
             )`
          )
          .bind(this.getMaxLogEntries())
          .run();
        return;
      }

      const logs = await this.getLogs();
      const next: LogRecord = {
        id: randomToken(6),
        action,
        detail: detail ?? null,
        createdAt: new Date().toISOString()
      };
      logs.unshift(next);
      await this.env.APP_KV.put(APP_KEYS.logsRecent, JSON.stringify(logs.slice(0, this.getMaxLogEntries())));
    } catch {
      // logging should never block the primary workflow
    }
  }

  private async ensureNavigationSeeded(): Promise<void> {
    const seeded = await this.getAppMetaValue(APP_KEYS.navigationSeeded);
    if (seeded) {
      return;
    }

    if (this.hasD1()) {
      const existingCount = await this.getNavigationCategoryCount();
      if (existingCount > 0) {
        await this.setAppMetaValue(APP_KEYS.navigationSeeded, '1');
        return;
      }
    }

    await this.seedNavigation();
  }

  private async seedNavigation(): Promise<void> {
    const categoryIds: string[] = [];
    for (const [categoryIndex, categorySeed] of NAVIGATION_SEED.entries()) {
      const categoryId = randomToken(8);
      categoryIds.push(categoryId);
      const categoryNow = new Date().toISOString();
      const category: CompatNavigationCategoryRecord = {
        id: categoryId,
        name: categorySeed.name,
        sortOrder: categoryIndex,
        createdAt: categoryNow,
        updatedAt: categoryNow
      };
      await this.saveNavigationCategory(category);

      const linkIds: string[] = [];
      for (const [linkIndex, linkSeed] of categorySeed.links.entries()) {
        const linkId = randomToken(8);
        linkIds.push(linkId);
        const linkNow = new Date().toISOString();
        await this.saveNavigationLink({
          id: linkId,
          categoryId,
          title: linkSeed.title,
          url: linkSeed.url,
          description: linkSeed.description,
          sortOrder: linkIndex,
          visitCount: 0,
          lastVisitedAt: null,
          createdAt: linkNow,
          updatedAt: linkNow
        });
      }

      await this.saveNavigationLinkIndex(categoryId, linkIds);
    }

    await this.saveNavigationCategoryIndex(categoryIds);
    await this.setAppMetaValue(APP_KEYS.navigationSeeded, '1');
  }

  private async getNavigationCategoryCount(): Promise<number> {
    if (this.hasD1()) {
      const row = await this.getDb().prepare('SELECT COUNT(*) AS count FROM navigation_categories').first<{ count: number }>();
      return Number(row?.count ?? 0);
    }

    return (await this.getNavigationCategoryIndex()).length;
  }

  private async saveNavigationCategory(category: CompatNavigationCategoryRecord): Promise<CompatNavigationCategoryRecord> {
    if (this.hasD1()) {
      await this.getDb()
        .prepare(
          `INSERT INTO navigation_categories (id, name, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             sort_order = excluded.sort_order,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at`
        )
        .bind(category.id, category.name, category.sortOrder, category.createdAt, category.updatedAt)
        .run();
      return category;
    }

    await this.env.APP_KV.put(`nav:category:${category.id}`, JSON.stringify(category));
    return category;
  }

  private async saveNavigationLink(link: CompatNavigationLinkRecord): Promise<CompatNavigationLinkRecord> {
    if (this.hasD1()) {
      await this.getDb()
        .prepare(
          `INSERT INTO navigation_links
           (id, category_id, title, url, description, sort_order, visit_count, last_visited_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             category_id = excluded.category_id,
             title = excluded.title,
             url = excluded.url,
             description = excluded.description,
             sort_order = excluded.sort_order,
             visit_count = excluded.visit_count,
             last_visited_at = excluded.last_visited_at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at`
        )
        .bind(
          link.id,
          link.categoryId,
          link.title,
          link.url,
          link.description,
          link.sortOrder,
          link.visitCount,
          link.lastVisitedAt,
          link.createdAt,
          link.updatedAt
        )
        .run();
      return link;
    }

    await this.env.APP_KV.put(`nav:link:${link.id}`, JSON.stringify(link));
    return link;
  }

  private async getNavigationCategoryIndex(): Promise<string[]> {
    if (this.hasD1()) {
      const result = await this.getDb().prepare('SELECT id FROM navigation_categories ORDER BY sort_order ASC').all<{ id: string }>();
      return (result.results ?? []).map((row) => row.id);
    }

    return this.getIndexArray(APP_KEYS.navCategoryIndex);
  }

  private async saveNavigationCategoryIndex(ids: string[]): Promise<void> {
    if (this.hasD1()) {
      return;
    }

    await this.env.APP_KV.put(APP_KEYS.navCategoryIndex, JSON.stringify(ids));
  }

  private async getNavigationLinkIndex(categoryId: string): Promise<string[]> {
    if (this.hasD1()) {
      const result = await this.getDb()
        .prepare('SELECT id FROM navigation_links WHERE category_id = ? ORDER BY sort_order ASC')
        .bind(categoryId)
        .all<{ id: string }>();
      return (result.results ?? []).map((row) => row.id);
    }

    return this.getIndexArray(`nav:link:index:${categoryId}`);
  }

  private async saveNavigationLinkIndex(categoryId: string, ids: string[]): Promise<void> {
    if (this.hasD1()) {
      return;
    }

    await this.env.APP_KV.put(`nav:link:index:${categoryId}`, JSON.stringify(ids));
  }

  private async getSourceIndex(): Promise<string[]> {
    if (this.hasD1()) {
      const result = await this.getDb().prepare('SELECT id FROM sources ORDER BY sort_order ASC').all<{ id: string }>();
      return (result.results ?? []).map((row) => row.id);
    }

    return this.getIndexArray(APP_KEYS.sourceIndex);
  }

  private async saveSourceIndex(ids: string[]): Promise<void> {
    if (this.hasD1()) {
      return;
    }

    await this.env.APP_KV.put(APP_KEYS.sourceIndex, JSON.stringify(ids));
  }

  private async getAppMetaValue(key: string): Promise<string | null> {
    if (this.hasD1()) {
      const row = await this.getDb().prepare('SELECT value FROM app_meta WHERE key = ?').bind(key).first<{ value: string }>();
      return row?.value ?? null;
    }

    return this.env.APP_KV.get(`meta:${key}`);
  }

  private async setAppMetaValue(key: string, value: string): Promise<void> {
    if (this.hasD1()) {
      await this.getDb()
        .prepare(
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

  private async getLogs(): Promise<LogRecord[]> {
    if (this.hasD1()) {
      const result = await this.getDb()
        .prepare('SELECT id, action, detail, created_at FROM app_logs ORDER BY created_at DESC LIMIT ?')
        .bind(this.getMaxLogEntries())
        .all<LogRow>();
      return (result.results ?? []).map(mapLogRow);
    }

    const logs = await this.env.APP_KV.get(APP_KEYS.logsRecent, 'json');
    return Array.isArray(logs) ? (logs.filter((log): log is LogRecord => Boolean(log && typeof log === 'object')) as LogRecord[]) : [];
  }

  private getMaxLogEntries(): number {
    return getMaxLogEntriesFromEnv(this.env);
  }

  private getDb(): D1Database {
    return this.env.DB as D1Database;
  }

  private hasD1(): boolean {
    return Boolean(this.env.DB);
  }

  private async getIndexArray(key: string): Promise<string[]> {
    const ids = await this.env.APP_KV.get(key, 'json');
    return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
  }
}

interface NavigationCategoryRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface NavigationLinkRow {
  id: string;
  category_id: string;
  title: string;
  url: string;
  description: string;
  sort_order: number;
  visit_count: number;
  last_visited_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  id: string;
  name: string;
  content: string;
  node_count: number;
  sort_order: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: string;
  action: string;
  detail: string | null;
  created_at: string;
}

function mapNavigationCategoryRow(row: NavigationCategoryRow): CompatNavigationCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapNavigationLinkRow(row: NavigationLinkRow): CompatNavigationLinkRecord {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    url: row.url,
    description: row.description ?? '',
    sortOrder: row.sort_order,
    visitCount: row.visit_count ?? 0,
    lastVisitedAt: row.last_visited_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSourceRow(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    nodeCount: row.node_count,
    sortOrder: row.sort_order,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLogRow(row: LogRow): LogRecord {
  return {
    id: row.id,
    action: row.action,
    detail: row.detail ?? null,
    createdAt: row.created_at
  };
}

function randomToken(byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (part) => part.toString(16).padStart(2, '0')).join('');
}
