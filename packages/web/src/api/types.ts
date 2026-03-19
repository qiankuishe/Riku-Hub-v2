export interface Source {
  id: string;
  name: string;
  content: string;
  nodeCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WarningItem {
  code: string;
  message: string;
  context?: string;
}

export interface ValidationResult {
  valid: boolean;
  urlCount: number;
  nodeCount: number;
  totalCount: number;
  duplicateCount: number;
  warnings: WarningItem[];
}

export interface SubFormat {
  name: string;
  key: string;
  url: string;
}

export interface SubInfo {
  formats: SubFormat[];
  totalNodes: number;
  lastAggregateTime: string;
  cacheStatus: string;
  lastRefreshTime: string;
  lastRefreshError: string;
  warningCount: number;
}

export interface LogRecord {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface NavigationLink {
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

export interface NavigationCategory {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  links: NavigationLink[];
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SnippetType = 'text' | 'code' | 'link' | 'image';

export interface SnippetRecord {
  id: string;
  type: SnippetType;
  title: string;
  content: string;
  isPinned: boolean;
  isLoginMapped?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicClipboardItem {
  id: string;
  title: string;
  content: string;
  nodeLabel: string;
  createdAt: string;
}

export interface SettingsExportStats {
  sources: number;
  navigationCategories: number;
  navigationLinks: number;
  notes: number;
  snippets: number;
}

export interface SettingsBackupPayload {
  version?: string;
  exportedAt?: string;
  stats?: SettingsExportStats;
  sources?: Source[];
  navigation?: NavigationCategory[];
  categories?: NavigationCategory[];
  notes?: NoteRecord[];
  snippets?: SnippetRecord[];
  clipboard_items?: SnippetRecord[];
}
