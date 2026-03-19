export interface CompatBindings {
  APP_KV: KVNamespace;
  DB?: D1Database;
  COMPAT_ALLOW_REGISTER?: string;
}

export type CompatClipboardItemType = 'text' | 'code' | 'link' | 'image';

export interface CompatSessionRecord {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

export interface CompatAuthUserDTO {
  id: number;
  email: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
}

export interface CompatClipboardItemRecord {
  id: string;
  type: CompatClipboardItemType;
  content: string;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompatClipboardItemDTO {
  id: string;
  content: string;
  type: CompatClipboardItemType;
  tags: string[];
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompatSettingsStatsDTO {
  categories: number;
  links: number;
  sources: number;
  articles: number;
  notes: number;
  clipboard_items: number;
  storage_used: string;
  storage_limit: string;
}

export interface CompatRegisterInput {
  email?: string;
  password?: string;
  username?: string;
}

export interface CompatClipboardCreateInput {
  content?: string;
  type?: string;
  tags?: string[] | string;
}

export interface CompatClipboardPinInput {
  is_pinned?: boolean;
  isPinned?: boolean;
}

export interface CompatClipboardListQuery {
  page?: string | null;
  limit?: string | null;
  type?: string | null;
  q?: string | null;
  tags?: string | null;
}

export interface CompatSettingsUpdateInput {
  [key: string]: unknown;
}
