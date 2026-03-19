import {
  deduplicateNodes,
  detectInputFormat,
  fixUrl,
  parseContent,
  parseMixedInput,
  renderFormat,
  type AggregateMeta,
  type AggregateWarning,
  type CachedFormatPayload,
  type CachedNodesPayload,
  type NormalizedNode,
  type OutputFormat,
  type SourceRecord,
  type ValidationSummary
} from '@riku-hub/shared';
import { buildFaviconUrl } from '../utils/compat';
import { isSafeNavigationUrl, normalizeNavigationUrl } from '../utils/navigation';
import {
  CompatNavSubRepository,
} from '../repositories/compat-nav-sub-repository';
import type { CompatNavigationCategoryRecord, CompatNavigationLinkRecord } from '../types/compat-nav-sub';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024;
const MAX_SUBSCRIPTION_EXPANSION_DEPTH = 2;
const MAX_SUBSCRIPTION_FETCH_CONCURRENCY = 8;
const MAX_SUBSCRIPTION_URLS_PER_SOURCE = 64;
let compatAggregateRefreshInFlight = false;

export class CompatNavSubHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { success: false; error: string }
  ) {
    super(body.error);
  }
}

export class CompatNavSubService {
  constructor(private readonly repository: CompatNavSubRepository) {}

  async listNavCategories(): Promise<
    Array<{
      id: string;
      name: string;
      icon: string | null;
      color: string | null;
      sort_order: number;
      link_count: number;
    }>
  > {
    const categories = await this.repository.getNavigationTree();
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      icon: null,
      color: null,
      sort_order: category.sortOrder,
      link_count: category.links.length
    }));
  }

  async createNavCategory(input: { name?: string; icon?: string; color?: string }): Promise<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    sort_order: number;
    link_count: number;
  }> {
    const name = input.name?.trim();
    if (!name) {
      throw new CompatNavSubHttpError(400, { success: false, error: '分类名称不能为空' });
    }

    const category = await this.repository.createNavigationCategory(name);
    void this.repository.appendLog('nav_category_create', `创建导航分类: ${category.name}`);
    return {
      id: category.id,
      name: category.name,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sort_order: category.sortOrder,
      link_count: 0
    };
  }

  async reorderNavCategories(input: { orders?: Array<{ id?: string; sort_order?: number }>; ids?: string[] }): Promise<void> {
    const ids =
      input.orders?.map((item) => item.id).filter((id): id is string => typeof id === 'string' && Boolean(id)) ??
      input.ids ??
      [];
    const categories = await this.repository.getNavigationCategories();
    const idSet = new Set(categories.map((category) => category.id));
    if (ids.length !== categories.length || ids.some((id) => !idSet.has(id))) {
      throw new CompatNavSubHttpError(400, { success: false, error: '排序数据无效' });
    }

    await this.repository.reorderNavigationCategories(ids);
  }

  async updateNavCategory(categoryId: string, input: { name?: string; icon?: string; color?: string }): Promise<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    sort_order: number;
  }> {
    const category = await this.repository.getNavigationCategory(categoryId);
    if (!category) {
      throw new CompatNavSubHttpError(404, { success: false, error: '分类不存在' });
    }

    const name = input.name?.trim();
    if (!name) {
      throw new CompatNavSubHttpError(400, { success: false, error: '分类名称不能为空' });
    }

    const updated = await this.repository.updateNavigationCategory(category.id, { name });
    if (!updated) {
      throw new CompatNavSubHttpError(404, { success: false, error: '分类不存在' });
    }

    return {
      id: updated.id,
      name: updated.name,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sort_order: updated.sortOrder
    };
  }

  async deleteNavCategory(categoryId: string): Promise<void> {
    const category = await this.repository.getNavigationCategory(categoryId);
    if (!category) {
      throw new CompatNavSubHttpError(404, { success: false, error: '分类不存在' });
    }

    await this.repository.deleteNavigationCategory(category.id);
    await this.repository.appendLog('nav_category_delete', `删除导航分类: ${category.name}`);
  }

  async listNavLinks(input: { category_id?: string; categoryId?: string; page?: string | null; limit?: string | null }): Promise<{
    items: Array<{
      id: string;
      title: string;
      url: string;
      description: string;
      favicon_url: string;
      category_id: string;
      visit_count: number;
      last_visited_at: string | null;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const categoryId = input.category_id?.trim() || input.categoryId?.trim() || '';
    const page = Math.max(Number.parseInt(input.page || '1', 10) || 1, 1);
    const limit = Math.max(Number.parseInt(input.limit || '20', 10) || 20, 1);
    const categories = categoryId
      ? (await Promise.all([this.repository.getNavigationCategory(categoryId)])).filter(
          (category): category is CompatNavigationCategoryRecord => Boolean(category)
        )
      : await this.repository.getNavigationCategories();
    const links = (await Promise.all(categories.map((category) => this.repository.getNavigationLinksByCategory(category.id)))).flat();
    const items = links
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .slice((page - 1) * limit, (page - 1) * limit + limit)
      .map((link) => mapNavigationLinkApi(link));

    return {
      items,
      total: links.length,
      page,
      limit
    };
  }

  async createNavLink(input: {
    category_id?: string;
    categoryId?: string;
    title?: string;
    url?: string;
    description?: string;
  }): Promise<{
    id: string;
    title: string;
    url: string;
    description: string;
    favicon_url: string;
    category_id: string;
    visit_count: number;
    last_visited_at: string | null;
  }> {
    const categoryId = input.category_id?.trim() || input.categoryId?.trim() || '';
    const title = input.title?.trim();
    const url = normalizeNavigationUrl(input.url);
    if (!categoryId || !title || !url) {
      throw new CompatNavSubHttpError(400, { success: false, error: '分类、标题和链接不能为空' });
    }

    const category = await this.repository.getNavigationCategory(categoryId);
    if (!category) {
      throw new CompatNavSubHttpError(404, { success: false, error: '分类不存在' });
    }

    if (!isSafeNavigationUrl(url)) {
      throw new CompatNavSubHttpError(400, { success: false, error: '站点链接必须是 http 或 https 地址' });
    }

    const link = await this.repository.createNavigationLink({
      categoryId,
      title,
      url,
      description: input.description?.trim() ?? ''
    });
    void this.repository.appendLog('nav_link_create', `创建导航站点: ${link.title}`);
    return mapNavigationLinkApi(link);
  }

  async reorderNavLinks(input: { category_id?: string; categoryId?: string; ids?: string[] }): Promise<void> {
    const categoryId = input.category_id?.trim() || input.categoryId?.trim() || '';
    const ids = input.ids ?? [];
    if (!categoryId || !ids.length) {
      throw new CompatNavSubHttpError(400, { success: false, error: '缺少分类标识或排序数据无效' });
    }

    const category = await this.repository.getNavigationCategory(categoryId);
    if (!category) {
      throw new CompatNavSubHttpError(404, { success: false, error: '分类不存在' });
    }

    const links = await this.repository.getNavigationLinksByCategory(categoryId);
    const idSet = new Set(links.map((link) => link.id));
    if (ids.length !== links.length || ids.some((id) => !idSet.has(id))) {
      throw new CompatNavSubHttpError(400, { success: false, error: '站点排序数据无效' });
    }

    await this.repository.reorderNavigationLinks(categoryId, ids);
  }

  async updateNavLink(
    linkId: string,
    input: {
      category_id?: string;
      categoryId?: string;
      title?: string;
      url?: string;
      description?: string;
    }
  ): Promise<{
    id: string;
    title: string;
    url: string;
    description: string;
    favicon_url: string;
    category_id: string;
    visit_count: number;
    last_visited_at: string | null;
  }> {
    const link = await this.repository.getNavigationLink(linkId);
    if (!link) {
      throw new CompatNavSubHttpError(404, { success: false, error: '站点不存在' });
    }

    const nextCategoryId = input.category_id?.trim() || input.categoryId?.trim() || link.categoryId;
    const nextUrl = input.url ? normalizeNavigationUrl(input.url) : link.url;
    const title = input.title?.trim() || link.title;
    const description = input.description?.trim() ?? link.description;

    if (!(await this.repository.getNavigationCategory(nextCategoryId))) {
      throw new CompatNavSubHttpError(404, { success: false, error: '目标分类不存在' });
    }
    if (!isSafeNavigationUrl(nextUrl)) {
      throw new CompatNavSubHttpError(400, { success: false, error: '站点链接必须是 http 或 https 地址' });
    }

    const updated = await this.repository.updateNavigationLink(link, {
      categoryId: nextCategoryId,
      title,
      url: nextUrl,
      description
    });
    return mapNavigationLinkApi(updated);
  }

  async deleteNavLink(linkId: string): Promise<void> {
    const link = await this.repository.getNavigationLink(linkId);
    if (!link) {
      throw new CompatNavSubHttpError(404, { success: false, error: '站点不存在' });
    }

    await this.repository.deleteNavigationLink(link.id, link.categoryId);
    await this.repository.appendLog('nav_link_delete', `删除导航站点: ${link.title}`);
  }

  async visitNavLink(linkId: string): Promise<{
    visit_count: number;
    last_visited_at: string | null;
  }> {
    const link = await this.repository.getNavigationLink(linkId);
    if (!link) {
      throw new CompatNavSubHttpError(404, { success: false, error: '站点不存在' });
    }

    const updated = await this.repository.recordNavigationLinkVisit(link);
    return {
      visit_count: updated.visitCount,
      last_visited_at: updated.lastVisitedAt
    };
  }

  async listSubSources(): Promise<
    Array<{
      id: string;
      name: string;
      url: string;
      category: string | null;
      favicon_url: string | null;
      last_fetched_at: string | null;
      is_active: boolean;
      article_count: number;
    }>
  > {
    const sources = await this.repository.getAllSources();
    return sources.map((source) => mapSourceApi(source));
  }

  async createSubSource(input: { name?: string; url?: string; content?: string }): Promise<{
    id: string;
    name: string;
    url: string;
    category: string | null;
    favicon_url: string | null;
    last_fetched_at: string | null;
    is_active: boolean;
    article_count: number;
  }> {
    const name = input.name?.trim();
    const content = (input.url ?? input.content ?? '').trim();
    if (!name || !content) {
      throw new CompatNavSubHttpError(400, { success: false, error: '名称和链接不能为空' });
    }

    const validation = await this.validateContent(content);
    const source = await this.repository.createSource(name, content, validation.nodeCount);
    await this.repository.invalidateCache();
    await this.repository.appendLog('source_create', `创建订阅源: ${source.name}`);
    return mapSourceApi(source);
  }

  async listSubArticles(input: { page?: string | null; limit?: string | null }): Promise<{
    items: [];
    total: number;
    unread_count: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(Number.parseInt(input.page || '1', 10) || 1, 1);
    const limit = Math.max(Number.parseInt(input.limit || '20', 10) || 20, 1);
    return {
      items: [],
      total: 0,
      unread_count: 0,
      page,
      limit
    };
  }

  async markSubArticleRead(): Promise<{ message: string }> {
    return { message: '已标记为已读' };
  }

  async fetchSub(input: { source_id?: string; sourceId?: string }): Promise<{
    fetched_count: number;
    new_articles: number;
  }> {
    const sourceId = input.source_id?.trim() || input.sourceId?.trim() || '';
    if (sourceId) {
      const source = await this.repository.getSource(sourceId);
      if (!source) {
        throw new CompatNavSubHttpError(404, { success: false, error: '订阅源不存在' });
      }

      const validation = await this.validateContent(source.content);
      return {
        fetched_count: 1,
        new_articles: validation.nodeCount
      };
    }

    const refresh = await this.refreshAggregateCache(true);
    if (!refresh.ok) {
      throw new CompatNavSubHttpError(500, { success: false, error: refresh.error });
    }

    return {
      fetched_count: refresh.sources.filter((source) => source.enabled).length,
      new_articles: refresh.payload.nodes.length
    };
  }

  async getSubInfo(request: Request): Promise<{
    formats: Array<{ name: string; key: string; url: string }>;
    totalNodes: number;
    lastAggregateTime: string;
    cacheStatus: AggregateMeta['cacheStatus'];
    lastRefreshTime: string;
    lastRefreshError: string;
    warningCount: number;
  }> {
    const subToken = await this.repository.getSubToken();
    const baseUrl = getHttpsOrigin(request);
    const meta = await this.repository.getAggregateMeta();
    return {
      formats: [
        { name: '自适应', key: 'auto', url: `${baseUrl}/sub?${subToken}` },
        { name: 'Base64', key: 'base64', url: `${baseUrl}/sub?${subToken}&base64` },
        { name: 'Clash', key: 'clash', url: `${baseUrl}/sub?${subToken}&clash` },
        { name: 'Stash', key: 'stash', url: `${baseUrl}/sub?${subToken}&stash` },
        { name: 'Surge', key: 'surge', url: `${baseUrl}/sub?${subToken}&surge` },
        { name: 'Loon', key: 'loon', url: `${baseUrl}/sub?${subToken}&loon` },
        { name: 'SingBox', key: 'singbox', url: `${baseUrl}/sub?${subToken}&singbox` },
        { name: 'Quantumult X', key: 'qx', url: `${baseUrl}/sub?${subToken}&qx` }
      ],
      totalNodes: meta.totalNodes,
      lastAggregateTime: meta.lastRefreshTime,
      cacheStatus: meta.cacheStatus,
      lastRefreshTime: meta.lastRefreshTime,
      lastRefreshError: meta.lastRefreshError,
      warningCount: meta.warningCount
    };
  }

  private async validateContent(content: string): Promise<ValidationSummary> {
    const resolved = await resolveNodesFromInput(this.repository, content);
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

  private async refreshAggregateCache(force: boolean): Promise<
    | { ok: true; payload: CachedNodesPayload; sources: SourceRecord[] }
    | { ok: false; error: string }
  > {
    if (compatAggregateRefreshInFlight) {
      if (force) {
        const baseline = await this.repository.getCachedNodes();
        const waited = await this.waitForNodesCache(6000, baseline?.refreshedAt ?? null);
        if (waited) {
          const sources = await this.repository.getAllSources();
          return { ok: true, payload: waited, sources };
        }
        return { ok: false, error: '刷新正在进行中' };
      }

      const cached = await this.repository.getCachedNodes();
      if (cached) {
        const sources = await this.repository.getAllSources();
        return { ok: true, payload: cached, sources };
      }
      return { ok: false, error: '刷新正在进行中' };
    }

    compatAggregateRefreshInFlight = true;

    try {
      const sources = await this.repository.getAllSources();
      const enabledSources = sources.filter((source) => source.enabled);
      if (enabledSources.length === 0) {
        await this.repository.saveAggregateMeta({
          cacheStatus: 'missing',
          totalNodes: 0,
          warningCount: 0,
          lastRefreshTime: '',
          lastRefreshError: '没有启用的订阅源'
        });
        return { ok: false, error: '没有启用的订阅源' };
      }

      const aggregated: NormalizedNode[] = [];
      const warnings: AggregateWarning[] = [];
      const updatedSources: SourceRecord[] = [];

      for (const source of enabledSources) {
        const expanded = await expandSourceContent(this.repository, source.content);
        aggregated.push(...expanded.uniqueNodes);
        warnings.push(...expanded.warnings);
        if (expanded.uniqueNodes.length !== source.nodeCount) {
          const updatedSource = await this.saveSourceNodeCount(source, expanded.uniqueNodes.length);
          updatedSources.push(updatedSource);
        } else {
          updatedSources.push(source);
        }
      }

      const disabledSources = sources.filter((source) => !source.enabled);
      const allSources = [...updatedSources, ...disabledSources].sort((left, right) => left.sortOrder - right.sortOrder);

      const deduped = deduplicateNodes(aggregated);
      const payload: CachedNodesPayload = {
        nodes: deduped.nodes,
        warnings,
        refreshedAt: new Date().toISOString()
      };

      await this.repository.saveCachedNodes(payload);
      for (const format of ['base64', 'clash', 'stash', 'surge', 'loon', 'qx', 'singbox'] satisfies OutputFormat[]) {
        const rendered = renderFormat(payload.nodes, format);
        const cachedFormat: CachedFormatPayload = {
          format,
          content: rendered.content,
          warnings: rendered.warnings,
          refreshedAt: payload.refreshedAt
        };
        await this.repository.saveCachedFormat(format, cachedFormat);
      }

      await this.repository.saveAggregateMeta({
        cacheStatus: 'fresh',
        totalNodes: payload.nodes.length,
        warningCount: warnings.length,
        lastRefreshTime: payload.refreshedAt,
        lastRefreshError: '',
        nextRefreshAfter: new Date(Date.now() + this.repository.getAggregateTtlSeconds() * 1000).toISOString()
      });

      return { ok: true, payload, sources: allSources };
    } catch (error) {
      const oldCache = await this.repository.getCachedNodes();
      await this.repository.saveAggregateMeta({
        cacheStatus: oldCache ? 'stale' : 'missing',
        totalNodes: oldCache?.nodes.length ?? 0,
        warningCount: oldCache?.warnings.length ?? 0,
        lastRefreshTime: oldCache?.refreshedAt ?? '',
        lastRefreshError: String(error)
      });
      if (!force && oldCache) {
        const sources = await this.repository.getAllSources();
        return { ok: true, payload: oldCache, sources };
      }
      return { ok: false, error: `刷新聚合缓存失败: ${String(error)}` };
    } finally {
      compatAggregateRefreshInFlight = false;
    }
  }

  private async waitForNodesCache(timeoutMs: number, baselineRefreshedAt: string | null): Promise<CachedNodesPayload | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cached = await this.repository.getCachedNodes();
      if (cached && (!baselineRefreshedAt || cached.refreshedAt !== baselineRefreshedAt)) {
        return cached;
      }
      await sleep(200);
    }
    return null;
  }

  private async saveSourceNodeCount(source: SourceRecord, nodeCount: number): Promise<SourceRecord> {
    const latest = await this.repository.getSource(source.id);
    const now = new Date().toISOString();

    if (!latest) {
      const fallback: SourceRecord = {
        ...source,
        nodeCount,
        updatedAt: now
      };
      await this.repository.saveSource(fallback);
      return fallback;
    }

    if (latest.nodeCount === nodeCount) {
      return latest;
    }

    const updated: SourceRecord = {
      ...latest,
      nodeCount,
      updatedAt: now
    };
    await this.repository.saveSource(updated);
    return updated;
  }
}

function mapNavigationLinkApi(link: CompatNavigationLinkRecord): {
  id: string;
  title: string;
  url: string;
  description: string;
  favicon_url: string;
  category_id: string;
  visit_count: number;
  last_visited_at: string | null;
} {
  return {
    id: link.id,
    title: link.title,
    url: link.url,
    description: link.description,
    favicon_url: buildFaviconUrl(link.url),
    category_id: link.categoryId,
    visit_count: link.visitCount,
    last_visited_at: link.lastVisitedAt
  };
}

function mapSourceApi(source: SourceRecord): {
  id: string;
  name: string;
  url: string;
  category: string | null;
  favicon_url: string | null;
  last_fetched_at: string | null;
  is_active: boolean;
  article_count: number;
} {
  return {
    id: source.id,
    name: source.name,
    url: source.content,
    category: null,
    favicon_url: null,
    last_fetched_at: source.updatedAt,
    is_active: source.enabled,
    article_count: source.nodeCount
  };
}

function getHttpsOrigin(request: Request): string {
  const url = new URL(request.url);
  return `https://${url.host}`;
}

async function fetchSubscription(repository: CompatNavSubRepository, rawUrl: string, depth = 0): Promise<{ text: string }> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`);
  }

  const url = new URL(fixUrl(rawUrl));
  await assertSafeUrl(repository, url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
      return fetchSubscription(repository, redirected.toString(), depth + 1);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_SUBSCRIPTION_BYTES) {
      throw new Error(`响应过大: ${contentLength} 字节（限制 ${MAX_SUBSCRIPTION_BYTES}）`);
    }

    const text = await readResponseTextWithLimit(response, MAX_SUBSCRIPTION_BYTES, controller);

    return { text };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时（${FETCH_TIMEOUT_MS / 1000}秒）`);
    }
    throw error;
  }
}

async function expandSourceContent(
  repository: CompatNavSubRepository,
  content: string
): Promise<{
  uniqueNodes: NormalizedNode[];
  warnings: AggregateWarning[];
}> {
  const resolved = await resolveNodesFromInput(repository, content);
  const deduped = deduplicateNodes(resolved.nodes);
  return { uniqueNodes: deduped.nodes, warnings: resolved.warnings };
}

async function resolveNodesFromInput(
  repository: CompatNavSubRepository,
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
  const urlsToProcess = mixed.urls.slice(0, MAX_SUBSCRIPTION_URLS_PER_SOURCE);
  if (mixed.urls.length > MAX_SUBSCRIPTION_URLS_PER_SOURCE) {
    warnings.push({
      code: 'fetch-failed',
      message: `订阅链接数量超过限制（${MAX_SUBSCRIPTION_URLS_PER_SOURCE}），已忽略多余链接`,
      context: String(mixed.urls.length)
    });
  }
  let urlCount = urlsToProcess.length;
  const seen = visitedUrls ?? new Set<string>();

  if (depth >= MAX_SUBSCRIPTION_EXPANSION_DEPTH) {
    for (const rawUrl of urlsToProcess) {
      warnings.push({
        code: 'fetch-failed',
        message: `订阅嵌套层级超过限制（${MAX_SUBSCRIPTION_EXPANSION_DEPTH}）`,
        context: rawUrl
      });
    }
    return { nodes, warnings, urlCount };
  }

  const results = await mapWithConcurrency(
    urlsToProcess,
    MAX_SUBSCRIPTION_FETCH_CONCURRENCY,
    async (rawUrl): Promise<{ nodes: NormalizedNode[]; warnings: AggregateWarning[]; urlCount: number }> => {
      const normalizedUrl = fixUrl(rawUrl);
      if (seen.has(normalizedUrl)) {
        return { nodes: [], warnings: [], urlCount: 0 };
      }

      seen.add(normalizedUrl);
      try {
        const fetched = await fetchSubscription(repository, normalizedUrl);
        return await resolveNodesFromInput(repository, fetched.text, depth + 1, seen);
      } catch (error) {
        return {
          nodes: [],
          warnings: [{ code: 'fetch-failed', message: `拉取订阅失败: ${String(error)}`, context: rawUrl }],
          urlCount: 0
        };
      }
    }
  );

  for (const result of results) {
    nodes.push(...result.nodes);
    warnings.push(...result.warnings);
    urlCount += result.urlCount;
  }

  return { nodes, warnings, urlCount };
}

async function mapWithConcurrency<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (inputs.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(concurrency, inputs.length));
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= inputs.length) {
        return;
      }
      results[currentIndex] = await mapper(inputs[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  controller?: AbortController
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) {
      controller?.abort();
      throw new Error(`响应过大: ${bytes} 字节（限制 ${maxBytes}）`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      controller?.abort();
      throw new Error(`响应过大: ${bytesRead} 字节（限制 ${maxBytes}）`);
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function assertSafeUrl(_repository: CompatNavSubRepository, url: URL): Promise<void> {
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

  const addresses = await resolveAddresses(hostname);
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`域名解析命中保留地址: ${hostname} -> ${address}`);
    }
  }
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  const [aRecords, aaaaRecords] = await Promise.all([resolveDnsType(hostname, 'A'), resolveDnsType(hostname, 'AAAA')]);
  return [...aRecords, ...aaaaRecords];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
