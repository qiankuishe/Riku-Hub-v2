import { Hono } from 'hono';
import { createAuthMiddleware } from './middlewares/auth';
import { NAVIGATION_SEED } from './navigation-seed';
import { ImagesRepository } from './repositories/images-repository';
import { createAuthController, mountAuthRoutes } from './routes/auth';
import { mountCompatRoutes } from './routes/compat';
import { mountNavigationRoutes } from './routes/navigation';
import { mountNotesRoutes } from './routes/notes';
import { mountSettingsRoutes } from './routes/settings';
import { mountSnippetsRoutes } from './routes/snippets';
import { mountSubscriptionsRoutes } from './routes/subscriptions';
import images from './routes/images';
import { proxyTelegramFile } from './services/telegram-service';
import { filterClipboardItems, normalizeClipboardType } from './utils/clipboard';
import {
  mapClipboardItemRow,
  mapLogRow,
  mapNavigationCategoryRow,
  mapNavigationLinkRow,
  mapNoteRow,
  mapSnippetRow,
  mapSourceRow
} from './utils/db-mappers';
import { isSafeNavigationUrl, normalizeNavigationUrl } from './utils/navigation';
import {
  getAggregateTtlSeconds,
  getAppMetaValue,
  getDatabase,
  getMaxLogEntries,
  hasD1,
  randomToken,
  setAppMetaValue
} from './utils/runtime';
import { getByteLength, getDefaultSnippetTitle, isSnippetType } from './utils/snippets';
import { sleep, mapWithConcurrency } from './utils/async';
import { getErrorStatusCode, formatError } from './utils/error';
import {
  isEnabledFlag,
  resolvePageAssetPath,
  enforceHttps,
  readResponseTextWithLimit,
  readResponseBytesWithLimit
} from './utils/http';
import { fetchAndCacheFavicon } from './utils/favicon';
import { assertSafeUrl } from './utils/ssrf';
import {
  refreshAggregateCache,
  ensureAggregateCache,
  waitForNodesCache,
  getAggregateMeta,
  saveAggregateMeta,
  getCachedNodes,
  getCachedFormat
} from './services/aggregate-service';
import { expandSourceContent, resolveNodesFromInput } from './services/subscription-fetch-service';
import {
  getSource,
  getAllSources,
  getSourceIndex,
  saveSourceIndex,
  createSource,
  saveSource,
  saveSourceNodeCount,
  deleteSource,
  getLastSaveTime
} from './repositories/sources-repository';
import type { ClipboardItemRecord, ClipboardItemType } from './types/clipboard';
import type {
  ClipboardItemRow,
  LogRow,
  NavigationCategoryRow,
  NavigationLinkRow,
  NoteRow,
  SnippetRow,
  SourceRow
} from './types/db-rows';
import type { NavigationCategoryPayload, NavigationCategoryRecord, NavigationLinkRecord } from './types/navigation';
import type { NoteRecord } from './types/notes';
import type {
  NavigationImportSkippedDetail,
  SettingsBackupPayload,
  SettingsDangerScope,
  SettingsExportStats,
  SettingsImportResult
} from './types/settings';
import type { SnippetRecord, SnippetType } from './types/snippets';
import {
  detectFormatFromUserAgent,
  detectInputFormat,
  deduplicateNodes,
  ensureHttpsUrl,
  fixUrl,
  parseContent,
  parseMixedInput,
  parseSubQuery,
  renderFormat,
  type AggregateMeta,
  type AggregateWarning,
  type CachedFormatPayload,
  type CachedNodesPayload,
  type LogRecord,
  type NormalizedNode,
  type OutputFormat,
  type SourceRecord,
  type ValidationSummary
} from '@riku-hub/shared';

interface PublicClipboardItem {
  id: string;
  title: string;
  content: string;
  nodeLabel: string;
  createdAt: string;
}

interface SettingsImportSnapshot {
  sources: SourceRecord[];
  navigation: NavigationCategoryPayload[];
  notes: NoteRecord[];
  snippets: SnippetRecord[];
  clipboardItems: ClipboardItemRecord[];
}

interface SettingsImportPayloadNormalized {
  sources: SourceRecord[];
  navigation: NavigationCategoryPayload[];
  notes: NoteRecord[];
  snippets: SnippetRecord[];
  clipboardItems: ClipboardItemRecord[];
}

export interface Env {
  APP_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  DB?: D1Database;
  ASSETS?: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  SUB_TOKEN?: string;
  AGGREGATE_TTL_SECONDS?: string;
  MAX_LOG_ENTRIES?: string;
  COMPAT_ALLOW_REGISTER?: string;
  COMPAT_REGISTER_KEY?: string;
  PUBLIC_CLIPBOARD_ENABLED?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();

const MAX_IMPORT_WRITE_CONCURRENCY = 16;
const MAX_IMAGE_SNIPPET_BYTES = 350 * 1024;
const MAX_FAVICON_BYTES = 64 * 1024;
const FAVICON_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const APP_KEYS = {
  subToken: 'config:sub-token',
  aggregateMeta: 'config:aggregate-meta',
  navigationSeeded: 'config:navigation-seeded',
  sourceIndex: 'source:index',
  logsRecent: 'logs:recent',
  navCategoryIndex: 'nav:category:index',
  noteIndex: 'note:index',
  snippetIndex: 'snippet:index',
  clipboardIndex: 'clipboard:index',
  refreshLock: 'lock:refresh-aggregate',
  settingsImportLock: 'lock:settings-import',
  kvToD1Migrated: 'migration:kv-to-d1-v1'
};

const CACHE_KEYS = {
  nodes: 'cache:nodes',
  format: (format: OutputFormat) => `cache:format:${format}`,
  favicon: (hostname: string) => `favicon:${hostname}`
};

const PUBLIC_NODE_LABELS = [
  'NODE_ALPHA_01',
  'NODE_BETA_02',
  'NODE_GAMMA_03',
  'NODE_DELTA_04',
  'NODE_EPSILON_05',
  'NODE_ZETA_06',
  'NODE_ETA_07',
  'NODE_THETA_08',
  'NODE_IOTA_09'
] as const;

const D1_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS navigation_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS navigation_links (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    visit_count INTEGER NOT NULL DEFAULT 0,
    last_visited_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES navigation_categories(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_navigation_links_category_sort ON navigation_links(category_id, sort_order)',
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_notes_sort ON notes(is_pinned DESC, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_login_mapped INTEGER NOT NULL DEFAULT 0,
    login_node_label TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_snippets_sort ON snippets(is_pinned DESC, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS clipboard_items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_clipboard_items_sort ON clipboard_items(is_pinned DESC, updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS app_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC)',
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    password_hash TEXT NOT NULL DEFAULT ''
  )`,
  'CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)',
  `CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    last_attempt INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0,
    lock_level INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_login_attempts_expires_at ON login_attempts(expires_at)',
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_sources_sort ON sources(sort_order, updated_at DESC)'
] as const;

let d1SchemaReady: Promise<void> | null = null;

app.onError((error, c) => {
  const status = getErrorStatusCode(error);
  if (status && status >= 400 && status < 500) {
    return new Response(JSON.stringify({ error: formatError(error) }), {
      status,
      headers: { 'content-type': 'application/json; charset=UTF-8' }
    });
  }
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.use('*', async (c, next) => {
  const redirected = enforceHttps(c.req.raw);
  if (redirected) {
    return redirected;
  }
  await ensureDatabaseSchema(c.env);
  await next();
});

app.get('/app', (c) => c.redirect('/', 302));
app.get('/app/nav', (c) => c.redirect('/nav', 302));
app.get('/app/subscriptions', (c) => c.redirect('/subscriptions', 302));
app.get('/app/notes', (c) => c.redirect('/notes', 302));
app.get('/app/snippets', (c) => c.redirect('/snippets', 302));
app.get('/app/images', (c) => c.redirect('/images', 302));
app.get('/app/logs', (c) => c.redirect('/logs', 302));
app.get('/app/settings', (c) => c.redirect('/settings', 302));

app.get('/health', (c) => c.json({ status: 'ok' }));

const authController = createAuthController((env, action, detail) => appendLog(env as Env, action, detail));
mountAuthRoutes(app, authController);

app.get('/api/clipboard/public', async (c) => {
  if (!isEnabledFlag(c.env.PUBLIC_CLIPBOARD_ENABLED)) {
    return c.json({ items: [] });
  }
  const snippets = await getLoginMappedSnippets(c.env);
  const items = mapPublicClipboardItems(snippets);
  return c.json({ items });
});

app.use('/api/*', createAuthMiddleware(authController as any));

app.get('/api/snippets/login-mapped', async (c) => {
  const snippets = await getLoginMappedSnippets(c.env);
  return c.json({ snippets });
});

mountCompatRoutes(app);

mountSubscriptionsRoutes<Env>(app, {
  deps: {
    getAllSources,
    getSource,
    validateContent,
    createSource,
    saveSource,
    saveSourceIndex,
    deleteSource,
    refreshAggregateCache: (env, force) =>
      refreshAggregateCache(env, force, getAllSources, expandSourceContent, saveSourceNodeCount, appendLog),
    getLastSaveTime,
    getSubToken,
    ensureAggregateCache: (env, format) =>
      ensureAggregateCache(env, format, getAllSources, expandSourceContent, saveSourceNodeCount, appendLog),
    invalidateCache,
    detectFormatFromUserAgent,
    parseSubQuery
  },
  appendLog: (env, action, detail) => appendLog(env, action, detail)
});

mountSettingsRoutes<Env>(app, {
  deps: {
    getLogs,
    getSettingsExportStats,
    getAllSources,
    getNavigationTree,
    getAllNotes,
    getAllSnippets,
    getAllClipboardItems,
    importSettingsBackup,
    clearSettingsScope
  },
  appendLog: (env, action, detail) => appendLog(env, action, detail)
});

mountNavigationRoutes<Env>(app, {
  deps: {
    getNavigationTree,
    getNavigationCategory,
    getNavigationCategories,
    createNavigationCategory,
    saveNavigationCategory,
    reorderNavigationCategories,
    deleteNavigationCategory,
    getNavigationLink,
    getNavigationLinksByCategory,
    createNavigationLink,
    reorderNavigationLinks,
    updateNavigationLink,
    deleteNavigationLink,
    recordNavigationLinkVisit,
    normalizeNavigationUrl,
    isSafeNavigationUrl
  },
  appendLog: (env, action, detail) => appendLog(env, action, detail)
});

app.get('/api/favicon', async (c) => {
  const rawUrl = c.req.query('url')?.trim();
  if (!rawUrl) {
    return c.json({ error: '缺少 url 参数' }, 400);
  }

  let hostname = '';
  try {
    hostname = new URL(fixUrl(rawUrl)).hostname.toLowerCase();
  } catch {
    return c.json({ error: 'favicon url 无效' }, 400);
  }

  if (!hostname) {
    return c.json({ error: 'favicon host 无效' }, 400);
  }

  const cached = await c.env.CACHE_KV.get(CACHE_KEYS.favicon(hostname), 'json');
  if (cached && typeof cached === 'object' && typeof (cached as { dataUrl?: unknown }).dataUrl === 'string') {
    return c.json({ dataUrl: (cached as { dataUrl: string }).dataUrl, cached: true });
  }

  const fetched = await fetchAndCacheFavicon(c.env, hostname);
  if (!fetched) {
    return c.json({ error: '未找到可用 favicon' }, 404);
  }

  return c.json({ dataUrl: fetched, cached: false });
});

mountNotesRoutes<Env>(app, {
  deps: {
    getAllNotes,
    getNoteRecord,
    createNoteRecord,
    saveNoteRecord,
    deleteNoteRecord
  }
});

mountSnippetsRoutes<Env>(app, {
  deps: {
    getAllSnippets,
    getSnippetRecord,
    saveSnippetRecord,
    createSnippetRecord,
    deleteSnippetRecord,
    isSnippetType,
    getDefaultSnippetTitle,
    getByteLength,
    maxImageSnippetBytes: MAX_IMAGE_SNIPPET_BYTES
  }
});

app.route('/api/images', images);

// 短路径别名 - 公开访问，不需要认证
app.get('/i/:id/:filename?', async (c) => {
  const id = c.req.param('id');

  const repository = new ImagesRepository(c.env.DB!);
  // 如果 ID 长度是 8，使用短 ID 查询；否则使用完整 ID
  const image = id.length === 8 
    ? await repository.getByShortIdPublic(id)
    : await repository.getByIdPublic(id);

  if (!image) {
    return c.text('File not found', 404);
  }

  return proxyTelegramFile(image.telegramFileId, image.fileName, c.env as any);
});

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    const pageAssetPath = resolvePageAssetPath(c.req.raw);
    if (pageAssetPath) {
      const pageUrl = new URL(pageAssetPath, c.req.raw.url);
      return c.env.ASSETS.fetch(new Request(pageUrl.toString(), c.req.raw));
    }
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default {
  fetch: app.fetch,
  scheduled: async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    await ensureDatabaseSchema(env);
    try {
      const refreshed = await refreshAggregateCache(
        env,
        false,
        getAllSources,
        expandSourceContent,
        saveSourceNodeCount,
        appendLog
      );
      if (!refreshed.ok && refreshed.error !== '刷新正在进行中') {
        await appendLog(env, 'aggregate_refresh_failed', `定时刷新失败: ${refreshed.error}`);
      }
    } catch (error) {
      await appendLog(env, 'aggregate_refresh_failed', `定时刷新异常: ${formatError(error)}`);
      throw error;
    }
  }
};

export { app };


async function validateContent(env: Env, content: string): Promise<ValidationSummary> {
  const resolved = await resolveNodesFromInput(env, content);
  const { nodes, duplicateCount } = deduplicateNodes(resolved.nodes);
  return {
    valid: resolved.urlCount > 0 || resolved.nodes.length > 0,
    urlCount: resolved.urlCount,
    nodeCount: nodes.length,
    totalCount: resolved.nodes.length,
    duplicateCount,
    warnings: resolved.warnings
  };
}

async function getSettingsExportStats(env: Env): Promise<SettingsExportStats> {
  const [sources, navigation, notes, snippets, clipboardItems] = await Promise.all([
    getAllSources(env),
    getNavigationTree(env),
    getAllNotes(env),
    getAllSnippets(env),
    getAllClipboardItems(env)
  ]);

  return {
    sources: sources.length,
    navigationCategories: navigation.length,
    navigationLinks: navigation.reduce((sum, category) => sum + category.links.length, 0),
    notes: notes.length,
    snippets: snippets.length,
    clipboardItems: clipboardItems.length
  };
}

async function clearSettingsScope(env: Env, scope: SettingsDangerScope): Promise<void> {
  switch (scope) {
    case 'sources':
      await clearAllSources(env);
      return;
    case 'navigation':
      await clearAllNavigation(env);
      return;
    case 'notes':
      await clearAllNotes(env);
      return;
    case 'snippets':
      await clearAllSnippets(env);
      return;
    case 'clipboard':
      await clearAllClipboard(env);
      return;
    case 'all':
      await clearAllSources(env);
      await clearAllNavigation(env);
      await clearAllNotes(env);
      await clearAllSnippets(env);
      await clearAllClipboard(env);
      await clearAllAuthSessions(env);
      return;
  }
}

function createStatusError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

async function withSettingsImportLock<T>(env: Env, handler: () => Promise<T>): Promise<T> {
  const lockKey = APP_KEYS.settingsImportLock;
  const lockValue = `${randomToken(8)}-${Date.now()}`;
  const lockTtlSeconds = 180;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const existingLock = await env.CACHE_KV.get(lockKey);
  if (existingLock) {
    const lockParts = existingLock.split('-');
    const lockTime = lockParts.length > 1 ? Number.parseInt(lockParts[1], 10) : 0;
    const isExpired = Date.now() - lockTime > lockTtlSeconds * 1000;
    if (!isExpired) {
      throw createStatusError(409, '设置导入正在进行中，请稍后重试');
    }
  }

  await env.CACHE_KV.put(lockKey, lockValue, { expirationTtl: lockTtlSeconds });
  const confirmed = await env.CACHE_KV.get(lockKey);
  if (confirmed !== lockValue) {
    throw createStatusError(409, '设置导入正在进行中，请稍后重试');
  }

  heartbeat = setInterval(() => {
    void env.CACHE_KV.put(lockKey, lockValue, { expirationTtl: lockTtlSeconds }).catch(() => {
      // 锁续租失败时，最终由主流程释放锁；这里避免中断导入主流程
    });
  }, Math.max(30_000, Math.floor((lockTtlSeconds * 1000) / 3)));

  try {
    return await handler();
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    const currentLock = await env.CACHE_KV.get(lockKey);
    if (currentLock === lockValue) {
      await env.CACHE_KV.delete(lockKey);
    }
  }
}

async function captureSettingsImportSnapshot(env: Env): Promise<SettingsImportSnapshot> {
  const [sources, navigation, notes, snippets, clipboardItems] = await Promise.all([
    getAllSources(env),
    getNavigationTree(env),
    getAllNotes(env),
    getAllSnippets(env),
    getAllClipboardItems(env)
  ]);
  return { sources, navigation, notes, snippets, clipboardItems };
}

async function restoreSettingsImportSnapshot(env: Env, snapshot: SettingsImportSnapshot): Promise<void> {
  await clearSettingsScope(env, 'all');

  if (snapshot.sources.length) {
    await replaceSources(env, snapshot.sources);
  }
  if (snapshot.navigation.length) {
    await replaceNavigation(env, snapshot.navigation);
  }
  if (snapshot.notes.length) {
    await replaceNotes(env, snapshot.notes);
  }
  if (snapshot.snippets.length) {
    await replaceSnippets(env, snapshot.snippets);
  }
  if (snapshot.clipboardItems.length) {
    await replaceClipboardItems(env, snapshot.clipboardItems);
  }
}

async function importSettingsBackup(env: Env, backup: SettingsBackupPayload): Promise<SettingsImportResult> {
  const skippedNavigationDetails: NavigationImportSkippedDetail[] = [];
  const payload: SettingsImportPayloadNormalized = {
    sources: normalizeSourceBackup(backup.sources),
    navigation: normalizeNavigationBackup(backup.navigation ?? backup.categories, skippedNavigationDetails),
    notes: normalizeNoteBackup(backup.notes),
    snippets: normalizeSnippetBackup(backup.snippets),
    clipboardItems: normalizeClipboardBackup(backup.clipboard ?? backup.clipboard_items)
  };
  const stats = buildSettingsImportStats(payload);
  const skipped = {
    navigation: {
      count: skippedNavigationDetails.length,
      details: skippedNavigationDetails
    }
  };

  return withSettingsImportLock(env, async () => {
    if (hasD1(env)) {
      await importSettingsBackupWithD1Transaction(env, payload);
      return {
        imported: stats,
        skipped
      };
    }

    const snapshot = await captureSettingsImportSnapshot(env);

    try {
      await clearSettingsScope(env, 'all');

      if (payload.sources.length) {
        await replaceSources(env, payload.sources);
      }

      if (payload.navigation.length) {
        await replaceNavigation(env, payload.navigation);
      }

      if (payload.notes.length) {
        await replaceNotes(env, payload.notes);
      }

      if (payload.snippets.length) {
        await replaceSnippets(env, payload.snippets);
      }

      if (payload.clipboardItems.length) {
        await replaceClipboardItems(env, payload.clipboardItems);
      }

      return {
        imported: stats,
        skipped
      };
    } catch (error) {
      try {
        await restoreSettingsImportSnapshot(env, snapshot);
        await appendLog(env, 'settings_import_rollback', `导入失败，已自动回滚: ${formatError(error)}`);
      } catch (rollbackError) {
        await appendLog(
          env,
          'settings_import_rollback_failed',
          `导入失败且回滚失败: import=${formatError(error)}; rollback=${formatError(rollbackError)}`
        );
        throw new Error(`设置导入失败且回滚失败: ${formatError(error)}`);
      }
      throw new Error(`设置导入失败，已自动回滚: ${formatError(error)}`);
    }
  });
}

function buildSettingsImportStats(payload: SettingsImportPayloadNormalized): SettingsExportStats {
  return {
    sources: payload.sources.length,
    navigationCategories: payload.navigation.length,
    navigationLinks: payload.navigation.reduce((sum, category) => sum + category.links.length, 0),
    notes: payload.notes.length,
    snippets: payload.snippets.length,
    clipboardItems: payload.clipboardItems.length
  };
}

async function importSettingsBackupWithD1Transaction(env: Env, payload: SettingsImportPayloadNormalized): Promise<void> {
  const db = getDatabase(env);
  const orderedSources = [...payload.sources].sort((left, right) => left.sortOrder - right.sortOrder);
  const orderedCategories = [...payload.navigation].sort((left, right) => left.sortOrder - right.sortOrder);
  const orderedNotes = [...payload.notes].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const orderedSnippets = [...payload.snippets].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const orderedClipboard = [...payload.clipboardItems].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const now = new Date().toISOString();

  await db.prepare('BEGIN IMMEDIATE').run();
  try {
    await db.batch([
      db.prepare('DELETE FROM sources'),
      db.prepare('DELETE FROM navigation_links'),
      db.prepare('DELETE FROM navigation_categories'),
      db.prepare('DELETE FROM notes'),
      db.prepare('DELETE FROM snippets'),
      db.prepare('DELETE FROM clipboard_items'),
      db.prepare('DELETE FROM auth_sessions')
    ]);

    for (const [index, source] of orderedSources.entries()) {
      await db
        .prepare(
          `INSERT INTO sources (id, name, content, node_count, sort_order, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          source.id,
          source.name,
          source.content,
          source.nodeCount,
          index,
          Number(source.enabled),
          source.createdAt,
          source.updatedAt
        )
        .run();
    }

    for (const [categoryIndex, category] of orderedCategories.entries()) {
      await db
        .prepare(
          `INSERT INTO navigation_categories (id, name, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(category.id, category.name, categoryIndex, category.createdAt, category.updatedAt)
        .run();

      const orderedLinks = [...category.links].sort((left, right) => left.sortOrder - right.sortOrder);
      for (const [linkIndex, link] of orderedLinks.entries()) {
        await db
          .prepare(
            `INSERT INTO navigation_links (id, category_id, title, url, description, sort_order, visit_count, last_visited_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            link.id,
            category.id,
            link.title,
            link.url,
            link.description,
            linkIndex,
            link.visitCount,
            link.lastVisitedAt,
            link.createdAt,
            link.updatedAt
          )
          .run();
      }
    }

    for (const note of orderedNotes) {
      await db
        .prepare(
          `INSERT INTO notes (id, title, content, is_pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(note.id, note.title, note.content, Number(note.isPinned), note.createdAt, note.updatedAt)
        .run();
    }

    for (const snippet of orderedSnippets) {
      await db
        .prepare(
          `INSERT INTO snippets (id, type, title, content, is_pinned, is_login_mapped, login_node_label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          snippet.id,
          snippet.type,
          snippet.title,
          snippet.content,
          Number(snippet.isPinned),
          Number(snippet.isLoginMapped),
          snippet.loginNodeLabel,
          snippet.createdAt,
          snippet.updatedAt
        )
        .run();
    }

    for (const item of orderedClipboard) {
      await db
        .prepare(
          `INSERT INTO clipboard_items (id, type, content, tags, is_pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(item.id, item.type, item.content, JSON.stringify(item.tags ?? []), Number(item.isPinned), item.createdAt, item.updatedAt)
        .run();
    }

    await db
      .prepare(
        `INSERT INTO app_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`
      )
      .bind(APP_KEYS.navigationSeeded, '1', now)
      .run();

    await db.prepare('COMMIT').run();
  } catch (error) {
    try {
      await db.prepare('ROLLBACK').run();
    } catch {
      // rollback failure should not hide import error
    }
    throw error;
  }

  await clearSubscriptionCache(env);
}

async function getSubToken(env: Env): Promise<string> {
  if (env.SUB_TOKEN) {
    return env.SUB_TOKEN;
  }

  const existing = await getAppMetaValue(env, APP_KEYS.subToken);
  if (existing) {
    return existing;
  }
  const created = randomToken(32);
  await setAppMetaValue(env, APP_KEYS.subToken, created);
  return created;
}

async function invalidateCache(env: Env): Promise<void> {
  // 清除节点缓存
  await env.CACHE_KV.delete(CACHE_KEYS.nodes);
  
  // 清除所有格式缓存
  const formats: OutputFormat[] = ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'];
  await Promise.all(formats.map((format) => env.CACHE_KV.delete(CACHE_KEYS.format(format))));
  
  // 更新元数据状态为 missing
  await saveAggregateMeta(env, {
    cacheStatus: 'missing',
    totalNodes: 0,
    warningCount: 0,
    lastRefreshTime: '',
    lastRefreshError: '缓存已清除，等待重新生成'
  });
}

async function appendLog(env: Env, action: string, detail?: string): Promise<void> {
  try {
    if (hasD1(env)) {
      await env.DB.prepare(
        'INSERT INTO app_logs (id, action, detail, created_at) VALUES (?, ?, ?, ?)'
      )
        .bind(randomToken(6), action, detail ?? null, new Date().toISOString())
        .run();
      await env.DB.prepare(
        `DELETE FROM app_logs
         WHERE id NOT IN (
           SELECT id FROM app_logs ORDER BY created_at DESC LIMIT ?
         )`
      )
        .bind(getMaxLogEntries(env))
        .run();
      return;
    }

    const logs = await getLogs(env);
    const next: LogRecord = {
      id: randomToken(6),
      action,
      detail: detail ?? null,
      createdAt: new Date().toISOString()
    };
    logs.unshift(next);
    await env.APP_KV.put(APP_KEYS.logsRecent, JSON.stringify(logs.slice(0, getMaxLogEntries(env))));
  } catch {
    // logging should never block the primary workflow
  }
}

async function getLogs(env: Env): Promise<LogRecord[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare(
      'SELECT id, action, detail, created_at FROM app_logs ORDER BY created_at DESC LIMIT ?'
    )
      .bind(getMaxLogEntries(env))
      .all<LogRow>();
    return (result.results ?? []).map(mapLogRow);
  }

  const logs = await env.APP_KV.get(APP_KEYS.logsRecent, 'json');
  return Array.isArray(logs) ? (logs.filter((log): log is LogRecord => Boolean(log && typeof log === 'object')) as LogRecord[]) : [];
}

async function ensureNavigationSeeded(env: Env): Promise<void> {
  const seeded = await getAppMetaValue(env, APP_KEYS.navigationSeeded);
  if (seeded) {
    return;
  }

  const existingCount = await getNavigationCategoryCount(env);
  if (existingCount > 0) {
    await setAppMetaValue(env, APP_KEYS.navigationSeeded, '1');
    return;
  }

  const categoryIds: string[] = [];
  for (const [categoryIndex, categorySeed] of NAVIGATION_SEED.entries()) {
    const categoryId = randomToken(8);
    categoryIds.push(categoryId);
    const categoryNow = new Date().toISOString();
    const category: NavigationCategoryRecord = {
      id: categoryId,
      name: categorySeed.name,
      sortOrder: categoryIndex,
      createdAt: categoryNow,
      updatedAt: categoryNow
    };
    await saveNavigationCategory(env, category);

    const linkIds: string[] = [];
    for (const [linkIndex, linkSeed] of categorySeed.links.entries()) {
      const linkId = randomToken(8);
      linkIds.push(linkId);
      const linkNow = new Date().toISOString();
      await saveNavigationLink(env, {
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

    await saveNavigationLinkIndex(env, categoryId, linkIds);
  }

  await saveNavigationCategoryIndex(env, categoryIds);
  await setAppMetaValue(env, APP_KEYS.navigationSeeded, '1');
}

async function getNavigationCategoryCount(env: Env): Promise<number> {
  if (hasD1(env)) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM navigation_categories').first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  return (await getNavigationCategoryIndex(env)).length;
}

async function getNavigationTree(env: Env): Promise<NavigationCategoryPayload[]> {
  await ensureNavigationSeeded(env);
  const categories = await getNavigationCategories(env);
  return Promise.all(
    categories.map(async (category) => ({
      ...category,
      links: await getNavigationLinksByCategory(env, category.id)
    }))
  );
}

async function getNavigationCategory(env: Env, id: string): Promise<NavigationCategoryRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      'SELECT id, name, sort_order, created_at, updated_at FROM navigation_categories WHERE id = ?'
    )
      .bind(id)
      .first<NavigationCategoryRow>();
    return row ? mapNavigationCategoryRow(row) : null;
  }

  const category = await env.APP_KV.get(`nav:category:${id}`, 'json');
  return category as NavigationCategoryRecord | null;
}

async function getNavigationCategories(env: Env): Promise<NavigationCategoryRecord[]> {
  await ensureNavigationSeeded(env);
  if (hasD1(env)) {
    const result = await env.DB.prepare(
      'SELECT id, name, sort_order, created_at, updated_at FROM navigation_categories ORDER BY sort_order ASC'
    ).all<NavigationCategoryRow>();
    return (result.results ?? []).map(mapNavigationCategoryRow);
  }

  const ids = await getNavigationCategoryIndex(env);
  const categories = await Promise.all(ids.map((id) => getNavigationCategory(env, id)));
  return categories.filter((category): category is NavigationCategoryRecord => Boolean(category)).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function getNavigationCategoryIndex(env: Env): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare('SELECT id FROM navigation_categories ORDER BY sort_order ASC').all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(APP_KEYS.navCategoryIndex, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

async function saveNavigationCategoryIndex(env: Env, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(APP_KEYS.navCategoryIndex, JSON.stringify(ids));
}

async function saveNavigationCategory(env: Env, category: NavigationCategoryRecord): Promise<NavigationCategoryRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
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

  await env.APP_KV.put(`nav:category:${category.id}`, JSON.stringify(category));
  return category;
}

async function createNavigationCategory(env: Env, name: string): Promise<NavigationCategoryRecord> {
  await ensureNavigationSeeded(env);
  const categories = await getNavigationCategories(env);
  const now = new Date().toISOString();
  const category: NavigationCategoryRecord = {
    id: randomToken(8),
    name,
    sortOrder: categories.length,
    createdAt: now,
    updatedAt: now
  };
  await saveNavigationCategory(env, category);
  if (hasD1(env)) {
    return category;
  }
  const ids = await getNavigationCategoryIndex(env);
  await saveNavigationCategoryIndex(env, [...ids, category.id]);
  await saveNavigationLinkIndex(env, category.id, []);
  return category;
}

async function reorderNavigationCategories(env: Env, ids: string[]): Promise<NavigationCategoryRecord[]> {
  const now = new Date().toISOString();
  if (!hasD1(env)) {
    await saveNavigationCategoryIndex(env, ids);
  }
  const categories = await Promise.all(
    ids.map(async (id, index) => {
      const category = await getNavigationCategory(env, id);
      if (!category) {
        return null;
      }
      return saveNavigationCategory(env, {
        ...category,
        sortOrder: index,
        updatedAt: now
      });
    })
  );
  return categories.filter((category): category is NavigationCategoryRecord => Boolean(category));
}

async function deleteNavigationCategory(env: Env, categoryId: string): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM navigation_categories WHERE id = ?').bind(categoryId).run();
    return;
  }

  const linkIds = await getNavigationLinkIndex(env, categoryId);
  await Promise.all(linkIds.map((id) => env.APP_KV.delete(`nav:link:${id}`)));
  await env.APP_KV.delete(`nav:link:index:${categoryId}`);
  await env.APP_KV.delete(`nav:category:${categoryId}`);

  const nextIds = (await getNavigationCategoryIndex(env)).filter((id) => id !== categoryId);
  await reorderNavigationCategories(env, nextIds);
}

async function getNavigationLink(env: Env, id: string): Promise<NavigationLinkRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      `SELECT id, category_id, title, url, description, sort_order, visit_count, last_visited_at, created_at, updated_at
       FROM navigation_links
       WHERE id = ?`
    )
      .bind(id)
      .first<NavigationLinkRow>();
    return row ? mapNavigationLinkRow(row) : null;
  }

  const link = await env.APP_KV.get(`nav:link:${id}`, 'json');
  if (!link) {
    return null;
  }

  const record = link as Partial<NavigationLinkRecord>;
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

async function getNavigationLinkIndex(env: Env, categoryId: string): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare(
      'SELECT id FROM navigation_links WHERE category_id = ? ORDER BY sort_order ASC'
    )
      .bind(categoryId)
      .all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(`nav:link:index:${categoryId}`, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

async function saveNavigationLinkIndex(env: Env, categoryId: string, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(`nav:link:index:${categoryId}`, JSON.stringify(ids));
}

async function saveNavigationLink(env: Env, link: NavigationLinkRecord): Promise<NavigationLinkRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
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

  await env.APP_KV.put(`nav:link:${link.id}`, JSON.stringify(link));
  return link;
}

async function getNavigationLinksByCategory(env: Env, categoryId: string): Promise<NavigationLinkRecord[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare(
      `SELECT id, category_id, title, url, description, sort_order, visit_count, last_visited_at, created_at, updated_at
       FROM navigation_links
       WHERE category_id = ?
       ORDER BY sort_order ASC`
    )
      .bind(categoryId)
      .all<NavigationLinkRow>();
    return (result.results ?? []).map(mapNavigationLinkRow);
  }

  const ids = await getNavigationLinkIndex(env, categoryId);
  const links = await Promise.all(ids.map((id) => getNavigationLink(env, id)));
  return links.filter((link): link is NavigationLinkRecord => Boolean(link)).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function createNavigationLink(
  env: Env,
  payload: Pick<NavigationLinkRecord, 'categoryId' | 'title' | 'url' | 'description'>
): Promise<NavigationLinkRecord> {
  const links = await getNavigationLinksByCategory(env, payload.categoryId);
  const now = new Date().toISOString();
  const link: NavigationLinkRecord = {
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
  await saveNavigationLink(env, link);
  if (hasD1(env)) {
    return link;
  }
  const ids = await getNavigationLinkIndex(env, payload.categoryId);
  await saveNavigationLinkIndex(env, payload.categoryId, [...ids, link.id]);
  return link;
}

async function reorderNavigationLinks(env: Env, categoryId: string, ids: string[]): Promise<NavigationLinkRecord[]> {
  if (!hasD1(env)) {
    await saveNavigationLinkIndex(env, categoryId, ids);
  }
  const now = new Date().toISOString();
  const links = await Promise.all(
    ids.map(async (id, index) => {
      const link = await getNavigationLink(env, id);
      if (!link) {
        return null;
      }
      return saveNavigationLink(env, {
        ...link,
        categoryId,
        sortOrder: index,
        updatedAt: now
      });
    })
  );
  return links.filter((link): link is NavigationLinkRecord => Boolean(link));
}

async function updateNavigationLink(
  env: Env,
  link: NavigationLinkRecord,
  payload: Pick<NavigationLinkRecord, 'categoryId' | 'title' | 'url' | 'description'>
): Promise<NavigationLinkRecord> {
  const now = new Date().toISOString();
  if (payload.categoryId === link.categoryId) {
    const updated = await saveNavigationLink(env, {
      ...link,
      title: payload.title,
      url: payload.url,
      description: payload.description,
      updatedAt: now
    });
    return updated;
  }

  const sourceIds = (await getNavigationLinkIndex(env, link.categoryId)).filter((id) => id !== link.id);
  await reorderNavigationLinks(env, link.categoryId, sourceIds);

  const targetIds = await getNavigationLinkIndex(env, payload.categoryId);
  const updated: NavigationLinkRecord = {
    ...link,
    categoryId: payload.categoryId,
    title: payload.title,
    url: payload.url,
    description: payload.description,
    sortOrder: targetIds.length,
    updatedAt: now
  };
  await saveNavigationLink(env, updated);
  await saveNavigationLinkIndex(env, payload.categoryId, [...targetIds, updated.id]);
  return updated;
}

async function deleteNavigationLink(env: Env, linkId: string, categoryId: string): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM navigation_links WHERE id = ?').bind(linkId).run();
    return;
  }

  await env.APP_KV.delete(`nav:link:${linkId}`);
  const nextIds = (await getNavigationLinkIndex(env, categoryId)).filter((id) => id !== linkId);
  await reorderNavigationLinks(env, categoryId, nextIds);
}

async function recordNavigationLinkVisit(env: Env, link: NavigationLinkRecord): Promise<NavigationLinkRecord> {
  if (hasD1(env)) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE navigation_links
       SET visit_count = visit_count + 1,
           last_visited_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, link.id)
      .run();
    const latest = await getNavigationLink(env, link.id);
    if (!latest) {
      throw createStatusError(404, '站点不存在');
    }
    return latest;
  }

  const updated: NavigationLinkRecord = {
    ...link,
    visitCount: (link.visitCount ?? 0) + 1,
    lastVisitedAt: new Date().toISOString()
  };
  return saveNavigationLink(env, updated);
}

async function getNoteIndex(env: Env): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare('SELECT id FROM notes ORDER BY created_at ASC').all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(APP_KEYS.noteIndex, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

async function saveNoteIndex(env: Env, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(APP_KEYS.noteIndex, JSON.stringify(ids));
}

async function getNoteRecord(env: Env, id: string): Promise<NoteRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      'SELECT id, title, content, is_pinned, created_at, updated_at FROM notes WHERE id = ?'
    )
      .bind(id)
      .first<NoteRow>();
    return row ? mapNoteRow(row) : null;
  }

  const note = await env.APP_KV.get(`note:${id}`, 'json');
  return note as NoteRecord | null;
}

async function saveNoteRecord(env: Env, note: NoteRecord): Promise<NoteRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
      `INSERT INTO notes (id, title, content, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         is_pinned = excluded.is_pinned,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    )
      .bind(note.id, note.title, note.content, Number(note.isPinned), note.createdAt, note.updatedAt)
      .run();
    return note;
  }

  await env.APP_KV.put(`note:${note.id}`, JSON.stringify(note));
  return note;
}

async function createNoteRecord(env: Env, title: string, content: string): Promise<NoteRecord> {
  const now = new Date().toISOString();
  const note: NoteRecord = {
    id: randomToken(8),
    title,
    content,
    isPinned: false,
    createdAt: now,
    updatedAt: now
  };
  await saveNoteRecord(env, note);
  if (hasD1(env)) {
    return note;
  }
  const ids = await getNoteIndex(env);
  await saveNoteIndex(env, [...ids, note.id]);
  return note;
}

async function deleteNoteRecord(env: Env, id: string): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();
    return;
  }

  const ids = await getNoteIndex(env);
  await env.APP_KV.delete(`note:${id}`);
  await saveNoteIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

async function getAllNotes(env: Env): Promise<NoteRecord[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare(
      'SELECT id, title, content, is_pinned, created_at, updated_at FROM notes ORDER BY is_pinned DESC, updated_at DESC'
    ).all<NoteRow>();
    return (result.results ?? []).map(mapNoteRow);
  }

  const ids = await getNoteIndex(env);
  const notes = await Promise.all(ids.map((id) => getNoteRecord(env, id)));
  return notes
    .filter((note): note is NoteRecord => Boolean(note))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
}

async function getSnippetIndex(env: Env): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare('SELECT id FROM snippets ORDER BY created_at ASC').all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(APP_KEYS.snippetIndex, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

async function saveSnippetIndex(env: Env, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(APP_KEYS.snippetIndex, JSON.stringify(ids));
}

async function getSnippetRecord(env: Env, id: string): Promise<SnippetRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      'SELECT id, type, title, content, is_pinned, is_login_mapped, login_node_label, created_at, updated_at FROM snippets WHERE id = ?'
    )
      .bind(id)
      .first<SnippetRow>();
    return row ? mapSnippetRow(row) : null;
  }

  const snippet = await env.APP_KV.get(`snippet:${id}`, 'json');
  if (!snippet || typeof snippet !== 'object') {
    return null;
  }

  const record = snippet as Partial<SnippetRecord>;
  return {
    id: String(record.id ?? id),
    type: record.type === 'code' || record.type === 'link' || record.type === 'image' ? record.type : 'text',
    title: typeof record.title === 'string' ? record.title : '',
    content: typeof record.content === 'string' ? record.content : '',
    isPinned: Boolean(record.isPinned),
    isLoginMapped: Boolean(record.isLoginMapped),
    loginNodeLabel: typeof record.loginNodeLabel === 'string' ? record.loginNodeLabel : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
  };
}

async function saveSnippetRecord(env: Env, snippet: SnippetRecord): Promise<SnippetRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
      `INSERT INTO snippets (id, type, title, content, is_pinned, is_login_mapped, login_node_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         title = excluded.title,
         content = excluded.content,
         is_pinned = excluded.is_pinned,
         is_login_mapped = excluded.is_login_mapped,
         login_node_label = excluded.login_node_label,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    )
      .bind(
        snippet.id,
        snippet.type,
        snippet.title,
        snippet.content,
        Number(snippet.isPinned),
        Number(snippet.isLoginMapped),
        snippet.loginNodeLabel,
        snippet.createdAt,
        snippet.updatedAt
      )
      .run();
    return snippet;
  }

  await env.APP_KV.put(`snippet:${snippet.id}`, JSON.stringify(snippet));
  return snippet;
}

async function createSnippetRecord(
  env: Env,
  payload: Pick<SnippetRecord, 'type' | 'title' | 'content'>
): Promise<SnippetRecord> {
  const now = new Date().toISOString();
  const snippet: SnippetRecord = {
    id: randomToken(8),
    type: payload.type,
    title: payload.title,
    content: payload.content,
    isPinned: false,
    isLoginMapped: false,
    loginNodeLabel: null,
    createdAt: now,
    updatedAt: now
  };
  await saveSnippetRecord(env, snippet);
  if (hasD1(env)) {
    return snippet;
  }
  const ids = await getSnippetIndex(env);
  await saveSnippetIndex(env, [...ids, snippet.id]);
  return snippet;
}

async function deleteSnippetRecord(env: Env, id: string): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM snippets WHERE id = ?').bind(id).run();
    return;
  }

  const ids = await getSnippetIndex(env);
  await env.APP_KV.delete(`snippet:${id}`);
  await saveSnippetIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

async function getAllSnippets(
  env: Env,
  options?: {
    type?: SnippetType;
    query?: string;
  }
): Promise<SnippetRecord[]> {
  if (hasD1(env)) {
    let query =
      'SELECT id, type, title, content, is_pinned, is_login_mapped, login_node_label, created_at, updated_at FROM snippets';
    const conditions: string[] = [];
    const bindings: Array<string | number> = [];

    if (options?.type) {
      conditions.push('type = ?');
      bindings.push(options.type);
    }
    if (options?.query) {
      conditions.push('(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)');
      const needle = `%${options.query.toLowerCase()}%`;
      bindings.push(needle, needle);
    }

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY is_pinned DESC, updated_at DESC';
    const result = await env.DB.prepare(query).bind(...bindings).all<SnippetRow>();
    return (result.results ?? []).map(mapSnippetRow);
  }

  const ids = await getSnippetIndex(env);
  const snippets = (await Promise.all(ids.map((id) => getSnippetRecord(env, id))))
    .filter((snippet): snippet is SnippetRecord => Boolean(snippet))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));

  return snippets.filter((snippet) => {
    if (options?.type && snippet.type !== options.type) {
      return false;
    }
    if (options?.query) {
      const needle = options.query.toLowerCase();
      return snippet.title.toLowerCase().includes(needle) || snippet.content.toLowerCase().includes(needle);
    }
    return true;
  });
}

async function getLoginMappedSnippets(env: Env): Promise<SnippetRecord[]> {
  const snippets = await getAllSnippets(env);
  return snippets
    .filter((snippet) => snippet.isLoginMapped)
    .sort((a, b) => {
      const indexA = a.loginNodeLabel ? PUBLIC_NODE_LABELS.indexOf(a.loginNodeLabel as (typeof PUBLIC_NODE_LABELS)[number]) : -1;
      const indexB = b.loginNodeLabel ? PUBLIC_NODE_LABELS.indexOf(b.loginNodeLabel as (typeof PUBLIC_NODE_LABELS)[number]) : -1;
      const safeA = indexA >= 0 ? indexA : PUBLIC_NODE_LABELS.length;
      const safeB = indexB >= 0 ? indexB : PUBLIC_NODE_LABELS.length;
      if (safeA !== safeB) {
        return safeA - safeB;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, PUBLIC_NODE_LABELS.length);
}

function mapPublicClipboardItems(snippets: SnippetRecord[]): PublicClipboardItem[] {
  return snippets.slice(0, PUBLIC_NODE_LABELS.length).map((snippet, index) => ({
    id: snippet.id,
    title: snippet.title || `节点 ${index + 1}`,
    content: snippet.type === 'image' ? '[图片片段]' : snippet.content,
    nodeLabel: snippet.loginNodeLabel || PUBLIC_NODE_LABELS[index],
    createdAt: snippet.createdAt
  }));
}

async function clearSubscriptionCache(env: Env): Promise<void> {
  const formats: OutputFormat[] = ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'];
  await Promise.all([env.CACHE_KV.delete(CACHE_KEYS.nodes), ...formats.map((format) => env.CACHE_KV.delete(CACHE_KEYS.format(format)))]);
  await saveAggregateMeta(env, {
    cacheStatus: 'missing',
    totalNodes: 0,
    warningCount: 0,
    lastRefreshTime: '',
    lastRefreshError: ''
  });
}

async function clearAllAuthSessions(env: Env): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM auth_sessions').run();
    return;
  }

  const kvWithList = env.APP_KV as KVNamespace & {
    list?: (options?: { prefix?: string; limit?: number; cursor?: string }) => Promise<{
      keys: Array<{ name: string }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  };

  if (typeof kvWithList.list !== 'function') {
    return;
  }

  let cursor: string | undefined;
  do {
    const listed = await kvWithList.list({ prefix: 'session:', limit: 1000, cursor });
    if (listed.keys.length > 0) {
      await Promise.all(listed.keys.map((item) => env.APP_KV.delete(item.name)));
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

async function clearAllSources(env: Env): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM sources').run();
    await clearSubscriptionCache(env);
    return;
  }

  const ids = await getSourceIndex(env);
  await Promise.all(ids.map((id) => env.APP_KV.delete(`source:${id}`)));
  await saveSourceIndex(env, []);
  await clearSubscriptionCache(env);
}

async function clearAllNavigation(env: Env): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM navigation_links').run();
    await env.DB.prepare('DELETE FROM navigation_categories').run();
    await setAppMetaValue(env, APP_KEYS.navigationSeeded, '1');
    return;
  }

  const categoryIds = await getNavigationCategoryIndex(env);
  const linkIndexLists = await Promise.all(categoryIds.map((categoryId) => getNavigationLinkIndex(env, categoryId)));
  const linkIds = linkIndexLists.flat();

  await Promise.all([
    ...categoryIds.map((categoryId) => env.APP_KV.delete(`nav:category:${categoryId}`)),
    ...categoryIds.map((categoryId) => env.APP_KV.delete(`nav:link:index:${categoryId}`)),
    ...linkIds.map((linkId) => env.APP_KV.delete(`nav:link:${linkId}`))
  ]);

  await saveNavigationCategoryIndex(env, []);
  await setAppMetaValue(env, APP_KEYS.navigationSeeded, '1');
}

async function clearAllNotes(env: Env): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM notes').run();
    return;
  }

  const ids = await getNoteIndex(env);
  await Promise.all(ids.map((id) => env.APP_KV.delete(`note:${id}`)));
  await saveNoteIndex(env, []);
}

async function clearAllSnippets(env: Env): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM snippets').run();
    return;
  }

  const ids = await getSnippetIndex(env);
  await Promise.all(ids.map((id) => env.APP_KV.delete(`snippet:${id}`)));
  await saveSnippetIndex(env, []);
}

function normalizeSourceBackup(records: SourceRecord[] | undefined): SourceRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((record, index) => {
    const now = new Date().toISOString();
    return {
      id: typeof record?.id === 'string' && record.id ? record.id : randomToken(8),
      name: typeof record?.name === 'string' ? record.name : `订阅源 ${index + 1}`,
      content: typeof record?.content === 'string' ? record.content : '',
      nodeCount: typeof record?.nodeCount === 'number' ? record.nodeCount : 0,
      sortOrder: typeof record?.sortOrder === 'number' ? record.sortOrder : index,
      enabled: typeof record?.enabled === 'boolean' ? record.enabled : true,
      createdAt: typeof record?.createdAt === 'string' && record.createdAt ? record.createdAt : now,
      updatedAt: typeof record?.updatedAt === 'string' && record.updatedAt ? record.updatedAt : now
    };
  });
}

function normalizeNavigationBackup(
  records: NavigationCategoryPayload[] | undefined,
  skippedDetails?: NavigationImportSkippedDetail[]
): NavigationCategoryPayload[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((category, categoryIndex) => {
    const now = new Date().toISOString();
    const categoryId = typeof category?.id === 'string' && category.id ? category.id : randomToken(8);
    const links = Array.isArray(category?.links) ? category.links : [];

    return {
      id: categoryId,
      name: typeof category?.name === 'string' ? category.name : `导入分类 ${categoryIndex + 1}`,
      sortOrder: typeof category?.sortOrder === 'number' ? category.sortOrder : categoryIndex,
      createdAt: typeof category?.createdAt === 'string' && category.createdAt ? category.createdAt : now,
      updatedAt: typeof category?.updatedAt === 'string' && category.updatedAt ? category.updatedAt : now,
      links: links
        .map((link, linkIndex) => {
          const rawUrl = typeof link?.url === 'string' ? link.url : '';

          // 先检查原始 URL 是否包含非法协议（在规范化之前）
          if (rawUrl && /^(javascript|data|file|vbscript|about):/i.test(rawUrl)) {
            skippedDetails?.push({
              categoryName: typeof category?.name === 'string' ? category.name : `导入分类 ${categoryIndex + 1}`,
              linkTitle: typeof link?.title === 'string' ? link.title : `链接 ${linkIndex + 1}`,
              url: rawUrl,
              reason: 'illegal_protocol'
            });
            console.warn(`[Import] Skipping unsafe URL with illegal protocol: ${rawUrl}`);
            return null;
          }

          const normalizedUrl = normalizeNavigationUrl(rawUrl);

          // 再次校验规范化后的 URL
          if (normalizedUrl && !isSafeNavigationUrl(normalizedUrl)) {
            skippedDetails?.push({
              categoryName: typeof category?.name === 'string' ? category.name : `导入分类 ${categoryIndex + 1}`,
              linkTitle: typeof link?.title === 'string' ? link.title : `链接 ${linkIndex + 1}`,
              url: rawUrl || normalizedUrl,
              reason: 'unsafe_url'
            });
            console.warn(`[Import] Skipping unsafe URL after normalization: ${rawUrl} (normalized: ${normalizedUrl})`);
            return null;
          }

          return {
            id: typeof link?.id === 'string' && link.id ? link.id : randomToken(8),
            categoryId,
            title: typeof link?.title === 'string' ? link.title : `链接 ${linkIndex + 1}`,
            url: normalizedUrl,
            description: typeof link?.description === 'string' ? link.description : '',
            sortOrder: typeof link?.sortOrder === 'number' ? link.sortOrder : linkIndex,
            visitCount: typeof link?.visitCount === 'number' ? link.visitCount : 0,
            lastVisitedAt: typeof link?.lastVisitedAt === 'string' ? link.lastVisitedAt : null,
            createdAt: typeof link?.createdAt === 'string' && link.createdAt ? link.createdAt : now,
            updatedAt: typeof link?.updatedAt === 'string' && link.updatedAt ? link.updatedAt : now
          };
        })
        .filter((link): link is NonNullable<typeof link> => link !== null)
    };
  });
}

function normalizeNoteBackup(records: NoteRecord[] | undefined): NoteRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((note, index) => {
    const now = new Date().toISOString();
    return {
      id: typeof note?.id === 'string' && note.id ? note.id : randomToken(8),
      title: typeof note?.title === 'string' ? note.title : `导入笔记 ${index + 1}`,
      content: typeof note?.content === 'string' ? note.content : '',
      isPinned: Boolean(note?.isPinned),
      createdAt: typeof note?.createdAt === 'string' && note.createdAt ? note.createdAt : now,
      updatedAt: typeof note?.updatedAt === 'string' && note.updatedAt ? note.updatedAt : now
    };
  });
}

function normalizeSnippetBackup(records: SnippetRecord[] | undefined): SnippetRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((snippet, index) => {
    const now = new Date().toISOString();
    const type: SnippetType =
      snippet?.type === 'code' || snippet?.type === 'link' || snippet?.type === 'image' ? snippet.type : 'text';
    const normalizedLabel =
      typeof snippet?.loginNodeLabel === 'string' && PUBLIC_NODE_LABELS.includes(snippet.loginNodeLabel as (typeof PUBLIC_NODE_LABELS)[number])
        ? snippet.loginNodeLabel
        : null;
    const isLoginMapped = Boolean(snippet?.isLoginMapped && normalizedLabel);

    return {
      id: typeof snippet?.id === 'string' && snippet.id ? snippet.id : randomToken(8),
      type,
      title: typeof snippet?.title === 'string' ? snippet.title : `导入片段 ${index + 1}`,
      content: typeof snippet?.content === 'string' ? snippet.content : '',
      isPinned: Boolean(snippet?.isPinned),
      isLoginMapped,
      loginNodeLabel: isLoginMapped ? normalizedLabel : null,
      createdAt: typeof snippet?.createdAt === 'string' && snippet.createdAt ? snippet.createdAt : now,
      updatedAt: typeof snippet?.updatedAt === 'string' && snippet.updatedAt ? snippet.updatedAt : now
    };
  });
}

function normalizeClipboardBackup(records: ClipboardItemRecord[] | undefined): ClipboardItemRecord[] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.map((item) => {
    const now = new Date().toISOString();
    const type = normalizeClipboardType(item?.type) ?? 'text';
    return {
      id: typeof item?.id === 'string' && item.id ? item.id : randomToken(8),
      type,
      content: typeof item?.content === 'string' ? item.content : '',
      tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      isPinned: Boolean(item?.isPinned),
      createdAt: typeof item?.createdAt === 'string' && item.createdAt ? item.createdAt : now,
      updatedAt: typeof item?.updatedAt === 'string' && item.updatedAt ? item.updatedAt : now
    };
  });
}

async function replaceSources(env: Env, sources: SourceRecord[]): Promise<void> {
  const ordered = [...sources].sort((left, right) => left.sortOrder - right.sortOrder);
  await mapWithConcurrency(ordered, MAX_IMPORT_WRITE_CONCURRENCY, async (source, index) =>
    saveSource(env, { ...source, sortOrder: index })
  );
  await saveSourceIndex(
    env,
    ordered.map((source) => source.id)
  );
  await clearSubscriptionCache(env);
}

async function replaceNavigation(env: Env, categories: NavigationCategoryPayload[]): Promise<void> {
  const orderedCategories = [...categories].sort((left, right) => left.sortOrder - right.sortOrder);

  for (const [categoryIndex, category] of orderedCategories.entries()) {
    await saveNavigationCategory(env, { ...category, sortOrder: categoryIndex });
    const orderedLinks = [...category.links].sort((left, right) => left.sortOrder - right.sortOrder);
    await Promise.all(
      orderedLinks.map((link, linkIndex) =>
        saveNavigationLink(env, {
          ...link,
          categoryId: category.id,
          sortOrder: linkIndex
        })
      )
    );
    await saveNavigationLinkIndex(
      env,
      category.id,
      orderedLinks.map((link) => link.id)
    );
  }

  await saveNavigationCategoryIndex(
    env,
    orderedCategories.map((category) => category.id)
  );
  await setAppMetaValue(env, APP_KEYS.navigationSeeded, '1');
}

async function replaceNotes(env: Env, notes: NoteRecord[]): Promise<void> {
  const ordered = [...notes].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await mapWithConcurrency(ordered, MAX_IMPORT_WRITE_CONCURRENCY, async (note) => saveNoteRecord(env, note));
  await saveNoteIndex(
    env,
    ordered.map((note) => note.id)
  );
}

async function replaceSnippets(env: Env, snippets: SnippetRecord[]): Promise<void> {
  const ordered = [...snippets].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await mapWithConcurrency(ordered, MAX_IMPORT_WRITE_CONCURRENCY, async (snippet) => saveSnippetRecord(env, snippet));
  await saveSnippetIndex(
    env,
    ordered.map((snippet) => snippet.id)
  );
}

async function getClipboardItem(env: Env, id: string): Promise<ClipboardItemRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      'SELECT id, type, content, tags, is_pinned, created_at, updated_at FROM clipboard_items WHERE id = ?'
    )
      .bind(id)
      .first<ClipboardItemRow>();
    return row ? mapClipboardItemRow(row) : null;
  }

  const item = await env.APP_KV.get(`clipboard:${id}`, 'json');
  return item as ClipboardItemRecord | null;
}

async function getAllClipboardItems(
  env: Env,
  options?: {
    type?: ClipboardItemType;
    tags?: string[];
    query?: string;
  }
): Promise<ClipboardItemRecord[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare(
      'SELECT id, type, content, tags, is_pinned, created_at, updated_at FROM clipboard_items ORDER BY is_pinned DESC, updated_at DESC'
    ).all<ClipboardItemRow>();
    const items = (result.results ?? []).map(mapClipboardItemRow);
    return filterClipboardItems(items, options);
  }

  const ids = await getClipboardIndex(env);
  const items = await Promise.all(ids.map((id) => getClipboardItem(env, id)));
  return filterClipboardItems(
    items.filter((item): item is ClipboardItemRecord => Boolean(item)).sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return Number(b.isPinned) - Number(a.isPinned);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    }),
    options
  );
}

async function saveClipboardItem(env: Env, item: ClipboardItemRecord): Promise<ClipboardItemRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
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
      .bind(item.id, item.type, item.content, JSON.stringify(item.tags ?? []), Number(item.isPinned), item.createdAt, item.updatedAt)
      .run();
    return item;
  }

  await env.APP_KV.put(`clipboard:${item.id}`, JSON.stringify(item));
  return item;
}

async function clearAllClipboard(env: Env): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM clipboard_items').run();
    return;
  }

  const ids = await getClipboardIndex(env);
  await Promise.all(ids.map((id) => env.APP_KV.delete(`clipboard:${id}`)));
  await saveClipboardIndex(env, []);
}

async function replaceClipboardItems(env: Env, items: ClipboardItemRecord[]): Promise<void> {
  const ordered = [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await mapWithConcurrency(ordered, MAX_IMPORT_WRITE_CONCURRENCY, async (item) => saveClipboardItem(env, item));
  await saveClipboardIndex(
    env,
    ordered.map((item) => item.id)
  );
}

async function getClipboardIndex(env: Env): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare('SELECT id FROM clipboard_items ORDER BY created_at ASC').all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(APP_KEYS.clipboardIndex, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

async function saveClipboardIndex(env: Env, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(APP_KEYS.clipboardIndex, JSON.stringify(ids));
}

async function ensureDatabaseSchema(env: Env): Promise<void> {
  if (!hasD1(env)) {
    return;
  }
  const db = getDatabase(env);
  if (!d1SchemaReady) {
    d1SchemaReady = db
      .batch(D1_SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)))
      .then(async () => {
        await ensureSnippetSchemaColumns(env);
        await ensureSourceSchemaColumns(env);
        await ensureAuthSessionSchemaColumns(env);
        await ensureKvDataMigratedToD1(env);
      })
      .catch((error) => {
        d1SchemaReady = null;
        throw error;
      });
  }
  await d1SchemaReady;
}

async function ensureSnippetSchemaColumns(env: Env): Promise<void> {
  if (!hasD1(env)) {
    return;
  }

  const db = getDatabase(env);
  const tableInfo = await db.prepare('PRAGMA table_info(snippets)').all<{ name: string }>();
  const columns = new Set((tableInfo.results ?? []).map((row) => row.name));
  const migrations: string[] = [];

  if (!columns.has('is_login_mapped')) {
    migrations.push('ALTER TABLE snippets ADD COLUMN is_login_mapped INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.has('login_node_label')) {
    migrations.push('ALTER TABLE snippets ADD COLUMN login_node_label TEXT');
  }

  for (const statement of migrations) {
    await db.prepare(statement).run();
  }
}

async function ensureSourceSchemaColumns(env: Env): Promise<void> {
  if (!hasD1(env)) {
    return;
  }

  const db = getDatabase(env);
  const tableInfo = await db.prepare('PRAGMA table_info(sources)').all<{ name: string }>();
  const columns = new Set((tableInfo.results ?? []).map((row) => row.name));
  if (!columns.has('enabled')) {
    await db.prepare('ALTER TABLE sources ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1').run();
  }
}

async function ensureAuthSessionSchemaColumns(env: Env): Promise<void> {
  if (!hasD1(env)) {
    return;
  }

  const db = getDatabase(env);
  const tableInfo = await db.prepare('PRAGMA table_info(auth_sessions)').all<{ name: string }>();
  const columns = new Set((tableInfo.results ?? []).map((row) => row.name));
  if (!columns.has('password_hash')) {
    await db.prepare("ALTER TABLE auth_sessions ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''").run();
  }
}

async function ensureKvDataMigratedToD1(env: Env): Promise<void> {
  if (!hasD1(env)) {
    return;
  }

  const migrated = await getAppMetaValue(env, APP_KEYS.kvToD1Migrated);
  if (migrated === '1') {
    return;
  }

  if (await hasAnyD1UserData(env)) {
    await setAppMetaValue(env, APP_KEYS.kvToD1Migrated, '1');
    return;
  }

  const legacyPayload = await readLegacySettingsFromKv(env);
  const hasLegacyData =
    legacyPayload.sources.length > 0 ||
    legacyPayload.navigation.length > 0 ||
    legacyPayload.notes.length > 0 ||
    legacyPayload.snippets.length > 0 ||
    legacyPayload.clipboardItems.length > 0;

  if (!hasLegacyData) {
    await setAppMetaValue(env, APP_KEYS.kvToD1Migrated, '1');
    return;
  }

  await importSettingsBackupWithD1Transaction(env, legacyPayload);
  await setAppMetaValue(env, APP_KEYS.kvToD1Migrated, '1');
  await appendLog(
    env,
    'kv_d1_migration',
    `已迁移历史数据到 D1：sources=${legacyPayload.sources.length}, categories=${legacyPayload.navigation.length}, notes=${legacyPayload.notes.length}, snippets=${legacyPayload.snippets.length}, clipboard=${legacyPayload.clipboardItems.length}`
  );
}

async function hasAnyD1UserData(env: Env): Promise<boolean> {
  if (!hasD1(env)) {
    return false;
  }

  const db = getDatabase(env);
  const [
    sourceCount,
    categoryCount,
    noteCount,
    snippetCount,
    clipboardCount,
    sessionCount
  ] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS count FROM sources').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM navigation_categories').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM notes').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM snippets').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM clipboard_items').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').first<{ count: number }>()
  ]);

  return (
    Number(sourceCount?.count ?? 0) > 0 ||
    Number(categoryCount?.count ?? 0) > 0 ||
    Number(noteCount?.count ?? 0) > 0 ||
    Number(snippetCount?.count ?? 0) > 0 ||
    Number(clipboardCount?.count ?? 0) > 0 ||
    Number(sessionCount?.count ?? 0) > 0
  );
}

async function readLegacySettingsFromKv(env: Env): Promise<SettingsImportPayloadNormalized> {
  const sourceIds = await readKvIndexArray(env.APP_KV, APP_KEYS.sourceIndex);
  const categoryIds = await readKvIndexArray(env.APP_KV, APP_KEYS.navCategoryIndex);
  const noteIds = await readKvIndexArray(env.APP_KV, APP_KEYS.noteIndex);
  const snippetIds = await readKvIndexArray(env.APP_KV, APP_KEYS.snippetIndex);
  const clipboardIds = await readKvIndexArray(env.APP_KV, APP_KEYS.clipboardIndex);

  const rawSources = (
    await Promise.all(sourceIds.map((id) => env.APP_KV.get(`source:${id}`, 'json')))
  ).filter((value): value is SourceRecord => Boolean(value && typeof value === 'object'));

  const rawNavigation = (
    await Promise.all(
      categoryIds.map(async (categoryId) => {
        const category = await env.APP_KV.get(`nav:category:${categoryId}`, 'json');
        if (!category || typeof category !== 'object') {
          return null;
        }
        const linkIds = await readKvIndexArray(env.APP_KV, `nav:link:index:${categoryId}`);
        const links = (
          await Promise.all(linkIds.map((linkId) => env.APP_KV.get(`nav:link:${linkId}`, 'json')))
        ).filter((value): value is NavigationLinkRecord => Boolean(value && typeof value === 'object'));
        return { ...(category as NavigationCategoryRecord), links };
      })
    )
  ).filter((value): value is NavigationCategoryPayload => Boolean(value));

  const rawNotes = (
    await Promise.all(noteIds.map((id) => env.APP_KV.get(`note:${id}`, 'json')))
  ).filter((value): value is NoteRecord => Boolean(value && typeof value === 'object'));

  const rawSnippets = (
    await Promise.all(snippetIds.map((id) => env.APP_KV.get(`snippet:${id}`, 'json')))
  ).filter((value): value is SnippetRecord => Boolean(value && typeof value === 'object'));

  const rawClipboard = (
    await Promise.all(clipboardIds.map((id) => env.APP_KV.get(`clipboard:${id}`, 'json')))
  ).filter((value): value is ClipboardItemRecord => Boolean(value && typeof value === 'object'));

  return {
    sources: normalizeSourceBackup(rawSources),
    navigation: normalizeNavigationBackup(rawNavigation),
    notes: normalizeNoteBackup(rawNotes),
    snippets: normalizeSnippetBackup(rawSnippets),
    clipboardItems: normalizeClipboardBackup(rawClipboard)
  };
}

async function readKvIndexArray(kv: KVNamespace, key: string): Promise<string[]> {
  const value = await kv.get(key, 'json');
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}
