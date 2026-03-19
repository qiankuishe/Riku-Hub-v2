import type { CompatBindings } from './compat';

export interface CompatNavSubBindings extends CompatBindings {
  CACHE_KV: KVNamespace;
  SUB_TOKEN?: string;
  AGGREGATE_TTL_SECONDS?: string;
  MAX_LOG_ENTRIES?: string;
}

export interface CompatNavigationCategoryRecord {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompatNavigationLinkRecord {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  description: string;
  sortOrder: number;
  visitCount: number;
  lastVisitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompatNavigationCategoryPayload extends CompatNavigationCategoryRecord {
  links: CompatNavigationLinkRecord[];
}
