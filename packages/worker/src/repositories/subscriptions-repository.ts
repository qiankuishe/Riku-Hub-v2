import type { ValidationSummary } from '@riku-hub/shared';
import type {
  EnsureAggregateCacheResult,
  SourceRecord,
  SourceRefreshResult,
  SubscriptionsRepositoryDeps
} from '../types/subscriptions';
import type { OutputFormat } from '@riku-hub/shared';

export class SubscriptionsRepository<TEnv> {
  constructor(
    private readonly env: TEnv,
    private readonly deps: SubscriptionsRepositoryDeps<TEnv>
  ) {}

  getAllSources(): Promise<SourceRecord[]> {
    return this.deps.getAllSources(this.env);
  }

  getSource(id: string): Promise<SourceRecord | null> {
    return this.deps.getSource(this.env, id);
  }

  validateContent(content: string): Promise<ValidationSummary> {
    return this.deps.validateContent(this.env, content);
  }

  createSource(name: string, content: string, nodeCount: number): Promise<SourceRecord> {
    return this.deps.createSource(this.env, name, content, nodeCount);
  }

  saveSource(source: SourceRecord): Promise<SourceRecord> {
    return this.deps.saveSource(this.env, source);
  }

  saveSourceIndex(ids: string[]): Promise<void> {
    return this.deps.saveSourceIndex(this.env, ids);
  }

  deleteSource(id: string): Promise<void> {
    return this.deps.deleteSource(this.env, id);
  }

  refreshAggregateCache(force: boolean): Promise<SourceRefreshResult> {
    return this.deps.refreshAggregateCache(this.env, force);
  }

  getLastSaveTime(sources: SourceRecord[]): string {
    return this.deps.getLastSaveTime(sources);
  }

  getSubToken(): Promise<string> {
    return this.deps.getSubToken(this.env);
  }

  ensureAggregateCache(format: OutputFormat): Promise<EnsureAggregateCacheResult> {
    return this.deps.ensureAggregateCache(this.env, format);
  }

  detectFormatFromUserAgent(userAgent: string): OutputFormat {
    return this.deps.detectFormatFromUserAgent(userAgent);
  }

  parseSubQuery(params: URLSearchParams): { token: string | null; format: OutputFormat | null } {
    return this.deps.parseSubQuery(params);
  }
}
