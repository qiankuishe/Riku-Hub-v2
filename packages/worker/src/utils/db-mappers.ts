import type { LogRecord, SourceRecord } from '@riku-hub/shared';
import type { ClipboardItemRecord } from '../types/clipboard';
import type { NavigationCategoryRecord, NavigationLinkRecord } from '../types/navigation';
import type { NoteRecord } from '../types/notes';
import type { SnippetRecord } from '../types/snippets';
import type {
  ClipboardItemRow,
  LogRow,
  NavigationCategoryRow,
  NavigationLinkRow,
  NoteRow,
  SnippetRow,
  SourceRow
} from '../types/db-rows';
import { parseJsonTags } from './clipboard';

export function mapNavigationCategoryRow(row: NavigationCategoryRow): NavigationCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapNavigationLinkRow(row: NavigationLinkRow): NavigationLinkRecord {
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

export function mapNoteRow(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isPinned: Boolean(row.is_pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapSnippetRow(row: SnippetRow): SnippetRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    isPinned: Boolean(row.is_pinned),
    isLoginMapped: Boolean(row.is_login_mapped),
    loginNodeLabel: row.login_node_label ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapClipboardItemRow(row: ClipboardItemRow): ClipboardItemRecord {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    tags: parseJsonTags(row.tags),
    isPinned: row.is_pinned > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapSourceRow(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    nodeCount: row.node_count,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapLogRow(row: LogRow): LogRecord {
  return {
    id: row.id,
    action: row.action,
    detail: row.detail ?? null,
    createdAt: row.created_at
  };
}
