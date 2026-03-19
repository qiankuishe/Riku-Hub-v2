import type { AggregateMeta, AggregateWarning, OutputFormat, ValidationSummary } from '@riku-hub/shared';

export interface SourceRecord {
  id: string;
  name: string;
  content: string;
  nodeCount: number;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SourceCreateInput {
  name?: string;
  content?: string;
}

export interface SourceUpdateInput {
  name?: string;
  content?: string;
  enabled?: boolean;
}

export interface SourceReorderInput {
  ids?: string[];
}

export interface SourceValidateInput {
  content?: string;
}

export type SourceRefreshResult =
  | {
      ok: true;
      payload: { nodes: unknown[] };
      sources: SourceRecord[];
    }
  | {
      ok: false;
      error: string;
    };

export type EnsureAggregateCacheResult =
  | {
      ok: true;
      payload: {
        content: string;
        warnings: AggregateWarning[];
        fromStaleCache: boolean;
      };
      meta: AggregateMeta;
    }
  | {
      ok: false;
      error: string;
      status?: number;
    };

export interface SubscriptionsRepositoryDeps<TEnv> {
  getAllSources: (env: TEnv) => Promise<SourceRecord[]>;
  getSource: (env: TEnv, id: string) => Promise<SourceRecord | null>;
  validateContent: (env: TEnv, content: string) => Promise<ValidationSummary>;
  createSource: (env: TEnv, name: string, content: string, nodeCount: number) => Promise<SourceRecord>;
  saveSource: (env: TEnv, source: SourceRecord) => Promise<SourceRecord>;
  saveSourceIndex: (env: TEnv, ids: string[]) => Promise<void>;
  deleteSource: (env: TEnv, id: string) => Promise<void>;
  refreshAggregateCache: (env: TEnv, force: boolean) => Promise<SourceRefreshResult>;
  getLastSaveTime: (sources: SourceRecord[]) => string;
  getSubToken: (env: TEnv) => Promise<string>;
  ensureAggregateCache: (env: TEnv, format: OutputFormat) => Promise<EnsureAggregateCacheResult>;
  invalidateCache: (env: TEnv) => Promise<void>;
  detectFormatFromUserAgent: (userAgent: string) => OutputFormat;
  parseSubQuery: (params: URLSearchParams) => { token: string | null; format: OutputFormat | null };
}
