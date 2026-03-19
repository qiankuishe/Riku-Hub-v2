import { Hono } from 'hono';
import { createAuthMiddleware } from './middlewares/auth';
import { NAVIGATION_SEED } from './navigation-seed';
import { createAuthController, mountAuthRoutes } from './routes/auth';
import { mountCompatRoutes } from './routes/compat';
import { mountNavigationRoutes } from './routes/navigation';
import { mountNotesRoutes } from './routes/notes';
import { mountSettingsRoutes } from './routes/settings';
import { mountSnippetsRoutes } from './routes/snippets';
import { mountSubscriptionsRoutes } from './routes/subscriptions';
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
import type { SettingsBackupPayload, SettingsDangerScope, SettingsExportStats } from './types/settings';
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
}

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();

const MAX_REDIRECTS = 3;
const MAX_SUBSCRIPTION_EXPANSION_DEPTH = 2;
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
  refreshLock: 'lock:refresh-aggregate'
};

const CACHE_KEYS = {
  nodes: 'cache:nodes',
  format: (format: OutputFormat) => `cache:format:${format}`,
  dns: (host: string, type: string) => `dns:${host}:${type}`,
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
    expires_at INTEGER NOT NULL
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
  return c.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, 500);
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
app.get('/app/logs', (c) => c.redirect('/logs', 302));
app.get('/app/settings', (c) => c.redirect('/settings', 302));

app.get('/health', (c) => c.json({ status: 'ok' }));

const authController = createAuthController((env, action, detail) => appendLog(env as Env, action, detail));
mountAuthRoutes(app, authController);

app.get('/api/clipboard/public', async (c) => {
  const snippets = await getLoginMappedSnippets(c.env);
  const items = mapPublicClipboardItems(snippets);
  return c.json({ items });
});

app.get('/api/snippets/login-mapped', async (c) => {
  const snippets = await getLoginMappedSnippets(c.env);
  return c.json({ snippets });
});

app.use('/api/*', createAuthMiddleware(authController as any));

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
    refreshAggregateCache,
    getLastSaveTime,
    getSubToken,
    ensureAggregateCache,
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
    await refreshAggregateCache(env, false);
  }
};

export { app };

function resolvePageAssetPath(request: Request): string | null {
  if (request.method !== 'GET') {
    return null;
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (
    pathname.startsWith('/api/') ||
    pathname === '/sub' ||
    pathname === '/health' ||
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.ico' ||
    pathname === '/logo.png'
  ) {
    return null;
  }

  const pageMap: Record<string, string> = {
    '/': '/index.html',
    '/reset': '/reset.html',
    '/login': '/login.html',
    '/nav': '/nav.html',
    '/navigation': '/navigation.html',
    '/subscriptions': '/subscriptions.html',
    '/notes': '/notes.html',
    '/snippets': '/snippets.html',
    '/clipboard': '/clipboard.html',
    '/logs': '/logs.html',
    '/settings': '/settings.html'
  };

  return pageMap[pathname] ?? null;
}

function enforceHttps(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return null;
  }
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const cfVisitor = request.headers.get('cf-visitor');
  const isHttps =
    url.protocol === 'https:' ||
    forwardedProto === 'https' ||
    (cfVisitor ? cfVisitor.includes('"scheme":"https"') : false);

  if (isHttps) {
    return null;
  }

  return Response.redirect(ensureHttpsUrl(url.toString()), 308);
}

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

async function refreshAggregateCache(env: Env, force: boolean): Promise<
  | { ok: true; payload: CachedNodesPayload; sources: SourceRecord[] }
  | { ok: false; error: string }
> {
  // 尝试获取锁，避免并发刷新
  const lockKey = APP_KEYS.refreshLock;
  const lockValue = `${randomToken(8)}-${Date.now()}`;
  const lockTtl = 120; // 2分钟锁超时
  
  // 检查是否已有锁
  const existingLock = await env.CACHE_KV.get(lockKey);
  if (existingLock && !force) {
    // 检查锁是否过期（防止死锁）
    const lockParts = existingLock.split('-');
    const lockTime = lockParts.length > 1 ? Number.parseInt(lockParts[1], 10) : 0;
    const isExpired = Date.now() - lockTime > lockTtl * 1000;
    
    if (!isExpired) {
      // 记录锁竞争日志
      await appendLog(env, 'refresh_lock_contention', `检测到并发刷新请求，返回缓存（锁持有时间: ${Date.now() - lockTime}ms）`);
      
      // 已有其他进程在刷新，直接返回当前缓存
      const cached = await getCachedNodes(env);
      if (cached) {
        const sources = await getAllSources(env);
        return { ok: true, payload: cached, sources };
      }
      return { ok: false, error: '刷新正在进行中' };
    } else {
      // 记录锁过期日志
      await appendLog(env, 'refresh_lock_expired', `检测到过期锁，强制获取（锁持有时间: ${Date.now() - lockTime}ms）`);
    }
  }
  
  // 获取锁（即使有竞争，也只是重复刷新，不会破坏数据）
  await env.CACHE_KV.put(lockKey, lockValue, { expirationTtl: lockTtl });
  
  try {
    const sources = await getAllSources(env);
    // 只聚合启用的订阅源
    const enabledSources = sources.filter(s => s.enabled);
    
    if (enabledSources.length === 0) {
      const meta = await saveAggregateMeta(env, {
        cacheStatus: 'missing',
        totalNodes: 0,
        warningCount: 0,
        lastRefreshTime: '',
        lastRefreshError: '没有启用的订阅源'
      });
      void meta;
      return { ok: false, error: '没有启用的订阅源' };
    }

    const aggregated: NormalizedNode[] = [];
    const warnings: AggregateWarning[] = [];
    const updatedSources: SourceRecord[] = [];

    for (const source of enabledSources) {
      const expanded = await expandSourceContent(env, source.content);
      aggregated.push(...expanded.uniqueNodes);
      warnings.push(...expanded.warnings);
      
      // 只在节点数变化时才更新 source 记录，避免写放大
      if (expanded.uniqueNodes.length !== source.nodeCount) {
        const updatedSource: SourceRecord = {
          ...source,
          nodeCount: expanded.uniqueNodes.length,
          updatedAt: new Date().toISOString()
        };
        updatedSources.push(updatedSource);
        await saveSource(env, updatedSource);
      } else {
        updatedSources.push(source);
      }
    }
    
    // 将禁用的订阅源也加入返回列表（但不参与聚合）
    const disabledSources = sources.filter(s => !s.enabled);
    const allSources = [...updatedSources, ...disabledSources].sort((a, b) => a.sortOrder - b.sortOrder);

    const deduped = deduplicateNodes(aggregated);
    const payload: CachedNodesPayload = {
      nodes: deduped.nodes,
      warnings,
      refreshedAt: new Date().toISOString()
    };

    await env.CACHE_KV.put(CACHE_KEYS.nodes, JSON.stringify(payload));
    for (const format of ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'] satisfies OutputFormat[]) {
      const rendered = renderFormat(payload.nodes, format);
      const cachedFormat: CachedFormatPayload = {
        format,
        content: rendered.content,
        warnings: rendered.warnings,
        refreshedAt: payload.refreshedAt
      };
      await env.CACHE_KV.put(CACHE_KEYS.format(format), JSON.stringify(cachedFormat));
    }

    await saveAggregateMeta(env, {
      cacheStatus: 'fresh',
      totalNodes: payload.nodes.length,
      warningCount: warnings.length,
      lastRefreshTime: payload.refreshedAt,
      lastRefreshError: '',
      nextRefreshAfter: new Date(Date.now() + getAggregateTtlSeconds(env) * 1000).toISOString()
    });

    return { ok: true, payload, sources: allSources };
  } catch (error) {
    const oldCache = await getCachedNodes(env);
    await saveAggregateMeta(env, {
      cacheStatus: oldCache ? 'stale' : 'missing',
      totalNodes: oldCache?.nodes.length ?? 0,
      warningCount: oldCache?.warnings.length ?? 0,
      lastRefreshTime: oldCache?.refreshedAt ?? '',
      lastRefreshError: String(error)
    });
    if (!force && oldCache) {
      const sources = await getAllSources(env);
      return { ok: true, payload: oldCache, sources };
    }
    return { ok: false, error: `刷新聚合缓存失败: ${String(error)}` };
  } finally {
    // 释放锁
    const currentLock = await env.CACHE_KV.get(lockKey);
    if (currentLock === lockValue) {
      await env.CACHE_KV.delete(lockKey);
    }
  }
}

async function ensureAggregateCache(
  env: Env,
  format: OutputFormat
): Promise<
  | {
      ok: true;
      payload: { content: string; warnings: AggregateWarning[]; fromStaleCache: boolean };
      meta: AggregateMeta;
    }
  | { ok: false; error: string; status?: number }
> {
  const ttlSeconds = getAggregateTtlSeconds(env);
  const meta = await getAggregateMeta(env);
  const cachedFormat = await getCachedFormat(env, format);
  const cachedNodes = await getCachedNodes(env);
  const isFresh = cachedNodes ? Date.now() - Date.parse(cachedNodes.refreshedAt) < ttlSeconds * 1000 : false;

  if (cachedFormat && cachedNodes && isFresh) {
    return {
      ok: true,
      payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: false },
      meta: { ...meta, cacheStatus: 'fresh' }
    };
  }

  const refreshed = await refreshAggregateCache(env, false);
  if (refreshed.ok) {
    const latest = await getCachedFormat(env, format);
    const nextMeta = await getAggregateMeta(env);
    if (latest) {
      return {
        ok: true,
        payload: { content: latest.content, warnings: latest.warnings, fromStaleCache: nextMeta.cacheStatus === 'stale' },
        meta: nextMeta
      };
    }
  }

  if (!refreshed.ok && refreshed.error === '刷新正在进行中') {
    const waited = await waitForFreshenedCache(env, format);
    if (waited) {
      return waited;
    }
    return { ok: false, error: '订阅缓存正在初始化中，请稍后重试', status: 503 };
  }

  if (cachedFormat) {
    return {
      ok: true,
      payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: true },
      meta: { ...meta, cacheStatus: 'stale' }
    };
  }

  return {
    ok: false,
    error: refreshed.ok ? '订阅缓存不可用' : refreshed.error,
    status: refreshed.ok ? 500 : refreshed.error === '刷新正在进行中' ? 503 : 500
  };
}

async function waitForFreshenedCache(
  env: Env,
  format: OutputFormat
): Promise<
  | {
      ok: true;
      payload: { content: string; warnings: AggregateWarning[]; fromStaleCache: boolean };
      meta: AggregateMeta;
    }
  | null
> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await sleep(200);
    const [cachedFormat, cachedNodes, meta] = await Promise.all([
      getCachedFormat(env, format),
      getCachedNodes(env),
      getAggregateMeta(env)
    ]);
    if (cachedFormat && cachedNodes) {
      return {
        ok: true,
        payload: { content: cachedFormat.content, warnings: cachedFormat.warnings, fromStaleCache: meta.cacheStatus === 'stale' },
        meta
      };
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expandSourceContent(env: Env, content: string): Promise<{
  uniqueNodes: NormalizedNode[];
  warnings: AggregateWarning[];
}> {
  const resolved = await resolveNodesFromInput(env, content);
  const deduped = deduplicateNodes(resolved.nodes);
  return { uniqueNodes: deduped.nodes, warnings: resolved.warnings };
}

async function resolveNodesFromInput(
  env: Env,
  content: string,
  depth = 0,
  visitedUrls?: Set<string>
): Promise<{ nodes: NormalizedNode[]; warnings: AggregateWarning[]; urlCount: number }> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { nodes: [], warnings: [], urlCount: 0 };
  }

  const mixed = parseMixedInput(trimmed);
  if (mixed.urls.length === 0 && mixed.nodes.length === 0) {
    const format = detectInputFormat(trimmed);
    const parsed = parseContent(trimmed, format);
    return { nodes: parsed.nodes, warnings: parsed.warnings, urlCount: 0 };
  }

  const nodes = [...mixed.nodes];
  const warnings = [...mixed.warnings];
  let urlCount = mixed.urls.length;
  const seen = visitedUrls ?? new Set<string>();

  if (depth >= MAX_SUBSCRIPTION_EXPANSION_DEPTH) {
    for (const rawUrl of mixed.urls) {
      warnings.push({
        code: 'fetch-failed',
        message: `订阅嵌套层级超过限制（${MAX_SUBSCRIPTION_EXPANSION_DEPTH}）`,
        context: rawUrl
      });
    }
    return { nodes, warnings, urlCount };
  }

  const results = await Promise.all(
    mixed.urls.map(
      async (
        rawUrl
      ): Promise<{ nodes: NormalizedNode[]; warnings: AggregateWarning[]; urlCount: number }> => {
        const normalizedUrl = fixUrl(rawUrl);
        if (seen.has(normalizedUrl)) {
          return { nodes: [], warnings: [], urlCount: 0 };
        }

        seen.add(normalizedUrl);
        try {
          const fetched = await fetchSubscription(env, normalizedUrl);
          return await resolveNodesFromInput(env, fetched.text, depth + 1, seen);
        } catch (error) {
          return {
            nodes: [],
            warnings: [{ code: 'fetch-failed', message: `拉取订阅失败: ${String(error)}`, context: rawUrl }],
            urlCount: 0
          };
        }
      }
    )
  );

  for (const result of results) {
    nodes.push(...result.nodes);
    warnings.push(...result.warnings);
    urlCount += result.urlCount;
  }

  return { nodes, warnings, urlCount };
}

async function fetchSubscription(env: Env, rawUrl: string, depth = 0): Promise<{ text: string }> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`);
  }

  const url = new URL(fixUrl(rawUrl));
  await assertSafeUrl(env, url);

  // 添加 30 秒超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Riku-Hub/0.1' },
      redirect: 'manual',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('上游返回重定向但缺少 Location');
      }
      const redirected = new URL(location, url);
      return fetchSubscription(env, redirected.toString(), depth + 1);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 检查响应大小，限制为 5MB
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > 5 * 1024 * 1024) {
      throw new Error(`响应过大: ${contentLength} 字节（限制 5MB）`);
    }

    const text = await response.text();
    
    // 再次检查实际大小
    if (text.length > 5 * 1024 * 1024) {
      throw new Error(`响应过大: ${text.length} 字节（限制 5MB）`);
    }

    return { text };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时（30秒）');
    }
    throw error;
  }
}

async function fetchAndCacheFavicon(env: Env, hostname: string): Promise<string | null> {
  const faviconSources = [
    `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`,
    `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${hostname}`)}&size=64`,
    `https://${hostname}/favicon.ico`
  ];

  for (const source of faviconSources) {
    try {
      const result = await fetchFaviconSource(env, source);
      if (!result) {
        continue;
      }

      const payload = JSON.stringify({ dataUrl: result.dataUrl, cachedAt: Date.now(), source });
      await env.CACHE_KV.put(CACHE_KEYS.favicon(hostname), payload, { expirationTtl: FAVICON_CACHE_TTL_SECONDS });
      return result.dataUrl;
    } catch {
      // ignore favicon source failures and try the next one
    }
  }

  return null;
}

async function fetchFaviconSource(env: Env, rawUrl: string): Promise<{ dataUrl: string } | null> {
  const url = new URL(rawUrl);
  await assertSafeUrl(env, url);

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Riku-Hub/0.1' },
    redirect: 'follow'
  });

  if (!response.ok) {
    return null;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!looksLikeFaviconContentType(contentType)) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_FAVICON_BYTES) {
    return null;
  }

  const mimeType = normalizeFaviconContentType(contentType);
  return {
    dataUrl: `data:${mimeType};base64,${toBase64(bytes)}`
  };
}

function looksLikeFaviconContentType(contentType: string): boolean {
  if (!contentType) {
    return true;
  }

  return (
    contentType.startsWith('image/') ||
    contentType.includes('icon') ||
    contentType.includes('svg') ||
    contentType.includes('octet-stream')
  );
}

function normalizeFaviconContentType(contentType: string): string {
  if (!contentType) {
    return 'image/png';
  }

  return contentType.split(';', 1)[0]?.trim() || 'image/png';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function assertSafeUrl(env: Env, url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`禁止协议: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (['localhost', 'localhost.localdomain', '0.0.0.0', '::1', '[::1]', '[::]'].includes(hostname)) {
    throw new Error(`禁止访问内网主机: ${hostname}`);
  }

  if (isInternalHostname(hostname)) {
    throw new Error(`禁止访问内网域名: ${hostname}`);
  }

  if (isIpAddress(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`禁止访问保留地址: ${hostname}`);
    }
    return;
  }

  const addresses = await resolveAddresses(env, hostname);
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`域名解析命中保留地址: ${hostname} -> ${address}`);
    }
  }
}

async function resolveAddresses(env: Env, hostname: string): Promise<string[]> {
  const cachedA = await getCachedDns(env, hostname, 'A');
  const cachedAAAA = await getCachedDns(env, hostname, 'AAAA');
  if (cachedA || cachedAAAA) {
    return [...(cachedA ?? []), ...(cachedAAAA ?? [])];
  }

  const [aRecords, aaaaRecords] = await Promise.all([resolveDnsType(hostname, 'A'), resolveDnsType(hostname, 'AAAA')]);
  await Promise.all([
    env.CACHE_KV.put(CACHE_KEYS.dns(hostname, 'A'), JSON.stringify(aRecords), { expirationTtl: 300 }),
    env.CACHE_KV.put(CACHE_KEYS.dns(hostname, 'AAAA'), JSON.stringify(aaaaRecords), { expirationTtl: 300 })
  ]);
  return [...aRecords, ...aaaaRecords];
}

async function getCachedDns(env: Env, hostname: string, type: 'A' | 'AAAA'): Promise<string[] | null> {
  return env.CACHE_KV.get(CACHE_KEYS.dns(hostname, type), 'json');
}

async function resolveDnsType(hostname: string, type: 'A' | 'AAAA'): Promise<string[]> {
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }
    });
    if (!response.ok) {
      throw new Error(`DNS 查询失败: HTTP ${response.status}`);
    }
    const data = (await response.json()) as { Answer?: Array<{ data?: string; type?: number }> };
    return (data.Answer ?? [])
      .filter((record) => Boolean(record.data))
      .map((record) => String(record.data))
      .filter((value) => (type === 'A' ? isIpv4(value) : isIpv6(value)));
  } catch (error) {
    // DNS 查询失败时抛出错误，而不是返回空数组放行
    throw new Error(`DNS 解析失败 (${hostname} ${type}): ${String(error)}`);
  }
}

function isInternalHostname(hostname: string): boolean {
  return ['.local', '.internal', '.lan', '.home', '.corp', '.intranet'].some((suffix) => hostname.endsWith(suffix));
}

function isIpAddress(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

function isIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isIpv6(value: string): boolean {
  return /^[a-fA-F0-9:]+$/.test(value) && value.includes(':');
}

function isBlockedIp(value: string): boolean {
  if (isIpv4(value)) {
    return [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,
      /^192\.0\.0\./,
      /^192\.0\.2\./,
      /^198\.18\./,
      /^198\.51\.100\./,
      /^203\.0\.113\./,
      /^224\./,
      /^240\./,
      /^255\./
    ].some((pattern) => pattern.test(value));
  }

  const normalized = value.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.')
  );
}

async function getSource(env: Env, id: string): Promise<SourceRecord | null> {
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      'SELECT id, name, content, node_count, sort_order, enabled, created_at, updated_at FROM sources WHERE id = ?'
    )
      .bind(id)
      .first<SourceRow>();
    return row ? mapSourceRow(row) : null;
  }

  const source = await env.APP_KV.get(`source:${id}`, 'json');
  return source as SourceRecord | null;
}

async function getAllSources(env: Env): Promise<SourceRecord[]> {
  const ids = await getSourceIndex(env);
  const records = await Promise.all(ids.map((id) => getSource(env, id)));
  return records.filter((record): record is SourceRecord => Boolean(record)).sort((a, b) => a.sortOrder - b.sortOrder);
}

async function getSourceIndex(env: Env): Promise<string[]> {
  if (hasD1(env)) {
    const result = await env.DB.prepare('SELECT id FROM sources ORDER BY sort_order ASC').all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  const ids = await env.APP_KV.get(APP_KEYS.sourceIndex, 'json');
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

async function saveSourceIndex(env: Env, ids: string[]): Promise<void> {
  if (hasD1(env)) {
    return;
  }

  await env.APP_KV.put(APP_KEYS.sourceIndex, JSON.stringify(ids));
}

async function createSource(env: Env, name: string, content: string, nodeCount: number): Promise<SourceRecord> {
  const ids = await getSourceIndex(env);
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
  await saveSource(env, source);
  await saveSourceIndex(env, [...ids, source.id]);
  return source;
}

async function saveSource(env: Env, source: SourceRecord): Promise<SourceRecord> {
  if (hasD1(env)) {
    await env.DB.prepare(
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

  await env.APP_KV.put(`source:${source.id}`, JSON.stringify(source));
  return source;
}

async function deleteSource(env: Env, id: string): Promise<void> {
  if (hasD1(env)) {
    await env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
    return;
  }

  const ids = await getSourceIndex(env);
  await env.APP_KV.delete(`source:${id}`);
  await saveSourceIndex(
    env,
    ids.filter((value) => value !== id)
  );
}

function getLastSaveTime(sources: SourceRecord[]): string {
  return sources.reduce((latest, source) => (source.updatedAt > latest ? source.updatedAt : latest), '');
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
      await Promise.all([
        clearAllSources(env),
        clearAllNavigation(env),
        clearAllNotes(env),
        clearAllSnippets(env),
        clearAllClipboard(env)
      ]);
      return;
  }
}

async function importSettingsBackup(env: Env, backup: SettingsBackupPayload): Promise<SettingsExportStats> {
  const sources = normalizeSourceBackup(backup.sources);
  const navigation = normalizeNavigationBackup(backup.navigation ?? backup.categories);
  const notes = normalizeNoteBackup(backup.notes);
  const snippets = normalizeSnippetBackup(backup.snippets);
  const clipboardItems = normalizeClipboardBackup(backup.clipboard ?? backup.clipboard_items);

  await clearSettingsScope(env, 'all');

  if (sources.length) {
    await replaceSources(env, sources);
  }

  if (navigation.length) {
    await replaceNavigation(env, navigation);
  }

  if (notes.length) {
    await replaceNotes(env, notes);
  }

  if (snippets.length) {
    await replaceSnippets(env, snippets);
  }

  if (clipboardItems.length) {
    await replaceClipboardItems(env, clipboardItems);
  }

  return {
    sources: sources.length,
    navigationCategories: navigation.length,
    navigationLinks: navigation.reduce((sum, category) => sum + category.links.length, 0),
    notes: notes.length,
    snippets: snippets.length,
    clipboardItems: clipboardItems.length
  };
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

async function getAggregateMeta(env: Env): Promise<AggregateMeta> {
  const raw = await getAppMetaValue(env, APP_KEYS.aggregateMeta);
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

async function saveAggregateMeta(env: Env, meta: AggregateMeta): Promise<AggregateMeta> {
  await setAppMetaValue(env, APP_KEYS.aggregateMeta, JSON.stringify(meta));
  return meta;
}

async function getCachedNodes(env: Env): Promise<CachedNodesPayload | null> {
  return env.CACHE_KV.get(CACHE_KEYS.nodes, 'json');
}

async function getCachedFormat(env: Env, format: OutputFormat): Promise<CachedFormatPayload | null> {
  return env.CACHE_KV.get(CACHE_KEYS.format(format), 'json');
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

function normalizeNavigationBackup(records: NavigationCategoryPayload[] | undefined): NavigationCategoryPayload[] {
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
      links: links.map((link, linkIndex) => ({
        id: typeof link?.id === 'string' && link.id ? link.id : randomToken(8),
        categoryId,
        title: typeof link?.title === 'string' ? link.title : `链接 ${linkIndex + 1}`,
        url: typeof link?.url === 'string' ? link.url : '',
        description: typeof link?.description === 'string' ? link.description : '',
        sortOrder: typeof link?.sortOrder === 'number' ? link.sortOrder : linkIndex,
        visitCount: typeof link?.visitCount === 'number' ? link.visitCount : 0,
        lastVisitedAt: typeof link?.lastVisitedAt === 'string' ? link.lastVisitedAt : null,
        createdAt: typeof link?.createdAt === 'string' && link.createdAt ? link.createdAt : now,
        updatedAt: typeof link?.updatedAt === 'string' && link.updatedAt ? link.updatedAt : now
      }))
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
  await Promise.all(ordered.map((source, index) => saveSource(env, { ...source, sortOrder: index })));
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
  await Promise.all(ordered.map((note) => saveNoteRecord(env, note)));
  await saveNoteIndex(
    env,
    ordered.map((note) => note.id)
  );
}

async function replaceSnippets(env: Env, snippets: SnippetRecord[]): Promise<void> {
  const ordered = [...snippets].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await Promise.all(ordered.map((snippet) => saveSnippetRecord(env, snippet)));
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
  await Promise.all(ordered.map((item) => saveClipboardItem(env, item)));
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
