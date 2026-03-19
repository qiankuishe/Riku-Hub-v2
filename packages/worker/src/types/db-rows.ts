import type { ClipboardItemType } from './clipboard';
import type { SnippetType } from './snippets';

export interface NavigationCategoryRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NavigationLinkRow {
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

export interface NoteRow {
  id: string;
  title: string;
  content: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export interface SnippetRow {
  id: string;
  type: SnippetType;
  title: string;
  content: string;
  is_pinned: number;
  is_login_mapped: number;
  login_node_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClipboardItemRow {
  id: string;
  type: ClipboardItemType;
  content: string;
  tags: string | null;
  is_pinned: number;
  created_at: string;
  updated_at: string;
}

export interface LogRow {
  id: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export interface SourceRow {
  id: string;
  name: string;
  content: string;
  node_count: number;
  sort_order: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}
