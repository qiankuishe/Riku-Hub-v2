import type { ClipboardItemRecord, ClipboardItemType } from '../types/clipboard';

export function normalizeClipboardType(value: string | null | undefined): ClipboardItemType | undefined {
  if (value === 'code' || value === 'link' || value === 'image') {
    return value;
  }
  if (value === 'text') {
    return 'text';
  }
  return undefined;
}

export function parseJsonTags(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((tag) => String(tag).trim()).filter(Boolean);
    }
  } catch {
    return parseCsvTags(value);
  }
  return [];
}

export function filterClipboardItems(
  items: ClipboardItemRecord[],
  options?: {
    type?: ClipboardItemType;
    tags?: string[];
    query?: string;
  }
): ClipboardItemRecord[] {
  return items.filter((item) => {
    if (options?.type && item.type !== options.type) {
      return false;
    }
    if (options?.tags?.length && !options.tags.every((tag) => item.tags.includes(tag))) {
      return false;
    }
    if (options?.query) {
      const needle = options.query.toLowerCase();
      return item.content.toLowerCase().includes(needle) || item.tags.some((tag) => tag.toLowerCase().includes(needle));
    }
    return true;
  });
}

function parseCsvTags(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

