import type { ValidationSummary } from '@riku-hub/shared';
import { SubscriptionsRepository } from '../repositories/subscriptions-repository';
import type { SourceCreateInput, SourceRecord, SourceReorderInput, SourceUpdateInput, SourceValidateInput } from '../types/subscriptions';

export class SubscriptionsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class SubscriptionsService<TEnv> {
  constructor(private readonly repository: SubscriptionsRepository<TEnv>) {}

  async listSources(): Promise<{ sources: SourceRecord[]; lastSaveTime: string }> {
    const sources = await this.repository.getAllSources();
    return {
      sources,
      lastSaveTime: this.repository.getLastSaveTime(sources)
    };
  }

  async getSource(id: string): Promise<SourceRecord> {
    const source = await this.repository.getSource(id);
    if (!source) {
      throw new SubscriptionsHttpError(404, '订阅源不存在');
    }
    return source;
  }

  async validateSource(input: SourceValidateInput): Promise<ValidationSummary> {
    return this.repository.validateContent(input.content ?? '');
  }

  async createSource(input: SourceCreateInput): Promise<{ source: SourceRecord; lastSaveTime: string }> {
    const name = input.name?.trim();
    const content = input.content?.trim();
    if (!name || !content) {
      throw new SubscriptionsHttpError(400, '名称和内容不能为空');
    }

    const validation = await this.repository.validateContent(content);
    const source = await this.repository.createSource(name, content, validation.nodeCount);
    return {
      source,
      lastSaveTime: source.updatedAt
    };
  }

  async reorderSources(input: SourceReorderInput): Promise<{ success: true; lastSaveTime: string }> {
    const ids = input.ids ?? [];
    const sources = await this.repository.getAllSources();
    const idSet = new Set(sources.map((source) => source.id));
    if (ids.some((id) => !idSet.has(id)) || ids.length !== sources.length) {
      throw new SubscriptionsHttpError(400, '排序数据无效');
    }

    await this.repository.saveSourceIndex(ids);
    const now = new Date().toISOString();
    await Promise.all(
      sources.map((source) =>
        this.repository.saveSource({
          ...source,
          sortOrder: ids.indexOf(source.id),
          updatedAt: now
        })
      )
    );

    return {
      success: true,
      lastSaveTime: now
    };
  }

  async updateSource(id: string, input: SourceUpdateInput): Promise<{ source: SourceRecord; lastSaveTime: string }> {
    const existing = await this.repository.getSource(id);
    if (!existing) {
      throw new SubscriptionsHttpError(404, '订阅源不存在');
    }

    let nodeCount = existing.nodeCount;
    if (typeof input.content === 'string') {
      const validation = await this.repository.validateContent(input.content);
      nodeCount = validation.nodeCount;
    }

    const updated = await this.repository.saveSource({
      ...existing,
      name: input.name?.trim() || existing.name,
      content: typeof input.content === 'string' ? input.content.trim() : existing.content,
      nodeCount,
      updatedAt: new Date().toISOString()
    });

    return {
      source: updated,
      lastSaveTime: updated.updatedAt
    };
  }

  async deleteSource(id: string): Promise<{ name: string; lastSaveTime: string }> {
    const source = await this.repository.getSource(id);
    if (!source) {
      throw new SubscriptionsHttpError(404, '订阅源不存在');
    }
    await this.repository.deleteSource(id);
    return {
      name: source.name,
      lastSaveTime: new Date().toISOString()
    };
  }

  async refreshSources(): Promise<{ sources: SourceRecord[]; lastSaveTime: string; nodeCount: number }> {
    const refresh = await this.repository.refreshAggregateCache(true);
    if (!refresh.ok) {
      throw new SubscriptionsHttpError(500, refresh.error);
    }

    return {
      sources: refresh.sources,
      lastSaveTime: this.repository.getLastSaveTime(refresh.sources),
      nodeCount: refresh.payload.nodes.length
    };
  }

  async buildSubscriptionPayload(
    requestUrl: string,
    userAgent: string
  ): Promise<{
    format: string;
    content: string;
    contentType: string;
    fileName: string;
    cacheStatus: string;
    warningCount: number;
    totalNodes: number;
    fromStaleCache: boolean;
  }> {
    const url = new URL(requestUrl);
    const { token, format: queryFormat } = this.repository.parseSubQuery(url.searchParams);
    const subToken = await this.repository.getSubToken();
    if (!token || token !== subToken) {
      throw new SubscriptionsHttpError(401, '无效的订阅 token');
    }

    const format = queryFormat ?? this.repository.detectFormatFromUserAgent(userAgent);
    const cacheResult = await this.repository.ensureAggregateCache(format);
    if (!cacheResult.ok) {
      throw new SubscriptionsHttpError(500, cacheResult.error);
    }

    return {
      format,
      content: cacheResult.payload.content,
      contentType: format === 'singbox' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      fileName: `riku-hub-${format}.txt`,
      cacheStatus: cacheResult.meta.cacheStatus,
      warningCount: cacheResult.payload.warnings.length,
      totalNodes: cacheResult.meta.totalNodes,
      fromStaleCache: cacheResult.payload.fromStaleCache
    };
  }
}
