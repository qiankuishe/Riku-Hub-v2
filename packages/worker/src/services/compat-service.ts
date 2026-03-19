import { parseCsvList } from '../utils/compat';
import type {
  CompatAuthUserDTO,
  CompatClipboardCreateInput,
  CompatClipboardItemDTO,
  CompatClipboardItemRecord,
  CompatClipboardItemType,
  CompatClipboardListQuery,
  CompatClipboardPinInput,
  CompatRegisterInput,
  CompatSettingsStatsDTO,
  CompatSettingsUpdateInput
} from '../types/compat';
import type { CompatRepository } from '../repositories/compat-repository';

export class CompatHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { success: false; error: string }
  ) {
    super(body.error);
  }
}

export class CompatService {
  constructor(private readonly repository: CompatRepository) {}

  async register(input: CompatRegisterInput): Promise<{ user: CompatAuthUserDTO; token: string }> {
    const email = input.email?.trim() ?? '';
    const password = input.password?.trim() ?? '';
    const username = input.username?.trim() || email.split('@')[0] || '';

    if (!email || !password || !username) {
      throw new CompatHttpError(400, { success: false, error: '邮箱、用户名和密码不能为空' });
    }

    const session = await this.repository.createSession(username);
    const user: CompatAuthUserDTO = {
      id: await stableUserId(email || username),
      email,
      username,
      avatar_url: null,
      created_at: new Date().toISOString()
    };

    await this.repository.saveAuthProfile(session.token, user);
    return { user, token: session.token };
  }

  async getCurrentUser(token: string | null): Promise<CompatAuthUserDTO> {
    if (!token) {
      throw new CompatHttpError(401, { success: false, error: '未登录或登录已过期' });
    }

    const session = await this.repository.getSession(token);
    if (!session) {
      throw new CompatHttpError(401, { success: false, error: '未登录或登录已过期' });
    }

    const profile = await this.repository.getAuthProfile(session.token);
    if (profile) {
      return profile;
    }

    return {
      id: await stableUserId(session.username),
      email: `${session.username}@example.com`,
      username: session.username,
      avatar_url: null,
      created_at: new Date(session.createdAt).toISOString()
    };
  }

  async listClipboard(query: CompatClipboardListQuery): Promise<{
    items: CompatClipboardItemDTO[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(Number.parseInt(query.page || '1', 10) || 1, 1);
    const limit = Math.max(Number.parseInt(query.limit || '50', 10) || 50, 1);
    const items = await this.repository.getClipboardItems();
    const filtered = filterClipboardItems(items, {
      type: normalizeClipboardType(query.type),
      tags: parseCsvList(query.tags),
      query: query.q?.trim() || undefined
    });
    const pagedItems = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    return {
      items: pagedItems.map(mapClipboardItemDto),
      total: filtered.length,
      page,
      limit
    };
  }

  async createClipboard(input: CompatClipboardCreateInput): Promise<CompatClipboardItemDTO> {
    const content = input.content?.trim() ?? '';
    if (!content) {
      throw new CompatHttpError(400, { success: false, error: '剪贴板内容不能为空' });
    }

    const now = new Date().toISOString();
    const item: CompatClipboardItemRecord = {
      id: randomToken(8),
      type: normalizeClipboardType(input.type) ?? 'text',
      content,
      tags: normalizeClipboardTags(input.tags),
      isPinned: false,
      createdAt: now,
      updatedAt: now
    };

    await this.repository.saveClipboardItem(item);
    return mapClipboardItemDto(item);
  }

  async deleteClipboard(id: string): Promise<void> {
    const item = await this.repository.getClipboardItem(id);
    if (!item) {
      throw new CompatHttpError(404, { success: false, error: '剪贴板项不存在' });
    }

    await this.repository.deleteClipboardItem(item.id);
  }

  async updateClipboardPin(id: string, input: CompatClipboardPinInput): Promise<CompatClipboardItemDTO> {
    const item = await this.repository.getClipboardItem(id);
    if (!item) {
      throw new CompatHttpError(404, { success: false, error: '剪贴板项不存在' });
    }

    const isPinned =
      typeof input.is_pinned === 'boolean'
        ? input.is_pinned
        : typeof input.isPinned === 'boolean'
          ? input.isPinned
          : item.isPinned;

    const updated: CompatClipboardItemRecord = {
      ...item,
      isPinned,
      updatedAt: new Date().toISOString()
    };

    await this.repository.saveClipboardItem(updated);
    return mapClipboardItemDto(updated);
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.repository.getSettingsValues();
  }

  async updateSettings(values: CompatSettingsUpdateInput): Promise<Record<string, unknown>> {
    return this.repository.updateSettingsValues(values);
  }

  async getSettingsStats(): Promise<CompatSettingsStatsDTO> {
    return this.repository.getSettingsStats();
  }
}

function filterClipboardItems(
  items: CompatClipboardItemRecord[],
  options?: {
    type?: CompatClipboardItemType;
    tags?: string[];
    query?: string;
  }
): CompatClipboardItemRecord[] {
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

function mapClipboardItemDto(item: CompatClipboardItemRecord): CompatClipboardItemDTO {
  return {
    id: item.id,
    content: item.content,
    type: item.type,
    tags: item.tags,
    is_pinned: item.isPinned,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function normalizeClipboardType(value: string | null | undefined): CompatClipboardItemType | undefined {
  if (value === 'code' || value === 'link' || value === 'image') {
    return value;
  }
  if (value === 'text') {
    return 'text';
  }
  return undefined;
}

function normalizeClipboardTags(value: string[] | string | undefined): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  return parseCsvList(value);
}

async function stableUserId(value: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Number.parseInt(Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('').slice(0, 8), 16);
}

function randomToken(byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (part) => part.toString(16).padStart(2, '0')).join('');
}
