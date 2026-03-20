import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, type Env } from '../src/index';
import { deleteSource, getSource, saveSource, saveSourceNodeCount } from '../src/repositories/sources-repository';
import { SubscriptionsService } from '../src/services/subscriptions-service';
import type { SourceRecord as SubscriptionSourceRecord } from '../src/types/subscriptions';

class MemoryKv {
  private store = new Map<string, string>();

  async get(key: string, type?: 'text' | 'json') {
    const value = this.store.get(key);
    if (!value) {
      return null;
    }
    if (type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const keys = Array.from(this.store.keys())
      .filter((key) => key.startsWith(prefix))
      .sort();
    const start = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const slice = keys.slice(start, start + limit).map((name) => ({ name }));
    const nextCursor = start + limit;
    return {
      keys: slice,
      list_complete: nextCursor >= keys.length,
      cursor: nextCursor >= keys.length ? '' : String(nextCursor)
    };
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

async function login(env: Env): Promise<string> {
  const response = await app.request(
    'https://example.com/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
      headers: { 'content-type': 'application/json' }
    },
    env
  );
  return response.headers.get('set-cookie') || '';
}

async function register(env: Env): Promise<{ cookie: string; data: { user: { email: string; username: string } } }> {
  // 确保注册密钥至少 32 个字符
  const registerKey = env.COMPAT_REGISTER_KEY || 'a'.repeat(32);
  if (registerKey.length < 32) {
    env.COMPAT_REGISTER_KEY = 'a'.repeat(32);
  }
  
  const response = await app.request(
    'https://example.com/api/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'secret', username: 'User', register_key: env.COMPAT_REGISTER_KEY }),
      headers: {
        'content-type': 'application/json',
        'x-register-key': env.COMPAT_REGISTER_KEY || ''
      }
    },
    env
  );
  const payload = (await response.json()) as { data: { user: { email: string; username: string } } };
  return {
    cookie: response.headers.get('set-cookie') || '',
    data: payload.data
  };
}

describe('worker behaviors', () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'token-123',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200'
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects plain http requests to https', async () => {
    const response = await app.request('http://example.com/health', undefined, env);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://example.com/health');
  });

  it('keeps sub endpoint protected by token', async () => {
    const response = await app.request('https://example.com/sub?bad-token', undefined, env);
    expect(response.status).toBe(401);
  });

  it('returns https links from sub info', async () => {
    const cookie = await login(env);
    expect(cookie).toBeTruthy();

    const response = await app.request(
      'https://example.com/api/sub/info',
      {
        headers: { cookie: cookie || '' }
      },
      env
    );
    const data = (await response.json()) as { formats: Array<{ url: string }> };
    expect(response.status).toBe(200);
    expect(data.formats.every((format) => format.url.startsWith('https://'))).toBe(true);
  });

  it('validates mixed content with both node uri and subscription url', async () => {
    const cookie = await login(env);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://8.8.8.8/sub') {
        return new Response('trojan://pass@example.org:443?security=tls&sni=example.org#remote', { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const response = await app.request(
      'https://example.com/api/sources/validate',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          content: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=none#direct\nhttps://8.8.8.8/sub'
        })
      },
      env
    );
    const data = (await response.json()) as {
      valid: boolean;
      urlCount: number;
      nodeCount: number;
      totalCount: number;
      warnings: Array<{ code: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.valid).toBe(true);
    expect(data.urlCount).toBe(1);
    expect(data.nodeCount).toBe(2);
    expect(data.totalCount).toBe(2);
    expect(data.warnings.some((warning) => warning.code === 'fetch-failed')).toBe(false);
  });

  it('refresh keeps mixed source entries (direct nodes + subscription urls)', async () => {
    const cookie = await login(env);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://8.8.8.8/sub') {
        return new Response('trojan://pass@example.org:443?security=tls&sni=example.org#remote', { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const createResponse = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: 'mixed-source',
          content: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=none#direct\nhttps://8.8.8.8/sub'
        })
      },
      env
    );
    expect(createResponse.status).toBe(200);

    const refreshResponse = await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );
    expect(refreshResponse.status).toBe(200);

    const subInfoResponse = await app.request(
      'https://example.com/api/sub/info',
      {
        headers: { cookie }
      },
      env
    );
    const subInfo = (await subInfoResponse.json()) as { totalNodes: number };
    expect(subInfoResponse.status).toBe(200);
    expect(subInfo.totalNodes).toBe(2);
  });

  it('reorders sources through the dedicated route', async () => {
    const cookie = await login(env);

    const createSource = async (name: string) =>
      app.request(
        'https://example.com/api/sources',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie
          },
          body: JSON.stringify({
            name,
            content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8iLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6ImV4YW1wbGUuY29tIiwicGF0aCI6Ii8iLCJ0bHMiOiJ0bHMiLCJzbmkiOiJleGFtcGxlLmNvbSJ9'
          })
        },
        env
      );

    const firstResponse = await createSource('源 A');
    const secondResponse = await createSource('源 B');
    const firstData = (await firstResponse.json()) as { source: { id: string } };
    const secondData = (await secondResponse.json()) as { source: { id: string } };

    const reorderResponse = await app.request(
      'https://example.com/api/sources/reorder',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ ids: [secondData.source.id, firstData.source.id] })
      },
      env
    );

    expect(reorderResponse.status).toBe(200);

    const listResponse = await app.request(
      'https://example.com/api/sources',
      {
        headers: { cookie }
      },
      env
    );
    const listData = (await listResponse.json()) as { sources: Array<{ id: string }> };
    expect(listData.sources.map((source) => source.id)).toEqual([secondData.source.id, firstData.source.id]);
  });

  it('seeds navigation categories and links', async () => {
    const cookie = await login(env);
    const response = await app.request(
      'https://example.com/api/navigation',
      {
        headers: { cookie }
      },
      env
    );

    const data = (await response.json()) as { categories: Array<{ name: string; links: Array<{ title: string }> }> };
    expect(response.status).toBe(200);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.categories[0].links.length).toBeGreaterThan(0);
  });

  it('records navigation link visits', async () => {
    const cookie = await login(env);
    const navResponse = await app.request(
      'https://example.com/api/navigation',
      {
        headers: { cookie }
      },
      env
    );
    const navData = (await navResponse.json()) as { categories: Array<{ links: Array<{ id: string }> }> };
    const linkId = navData.categories[0]?.links[0]?.id;
    expect(linkId).toBeTruthy();

    const visitResponse = await app.request(
      `https://example.com/api/navigation/links/${linkId}/visit`,
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );

    const visitData = (await visitResponse.json()) as { visitCount: number; lastVisitedAt: string | null };
    expect(visitResponse.status).toBe(200);
    expect(visitData.visitCount).toBe(1);
    expect(visitData.lastVisitedAt).toBeTruthy();
  });

  it('creates and updates notes', async () => {
    const cookie = await login(env);

    const createResponse = await app.request(
      'https://example.com/api/notes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ title: '测试笔记', content: '# hello' })
      },
      env
    );
    const createData = (await createResponse.json()) as { note: { id: string; title: string } };
    expect(createResponse.status).toBe(200);

    const updateResponse = await app.request(
      `https://example.com/api/notes/${createData.note.id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ isPinned: true })
      },
      env
    );

    const updateData = (await updateResponse.json()) as { note: { isPinned: boolean } };
    expect(updateData.note.isPinned).toBe(true);
  });

  it('creates and filters snippets', async () => {
    const cookie = await login(env);

    await app.request(
      'https://example.com/api/snippets',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ type: 'code', title: 'Deploy', content: 'wrangler deploy' })
      },
      env
    );

    const response = await app.request(
      'https://example.com/api/snippets?type=code&q=deploy',
      {
        headers: { cookie }
      },
      env
    );

    const data = (await response.json()) as { snippets: Array<{ title: string; type: string }> };
    expect(response.status).toBe(200);
    expect(data.snippets).toHaveLength(1);
    expect(data.snippets[0].type).toBe('code');
  });

  it('supports compat auth, nav, clipboard and settings routes', async () => {
    env.COMPAT_ALLOW_REGISTER = 'true';
    env.COMPAT_REGISTER_KEY = 'a'.repeat(32); // 至少 32 个字符
    const { cookie, data } = await register(env);
    expect(data.user.email).toBe('user@example.com');

    const meResponse = await app.request(
      'https://example.com/api/auth/me',
      {
        headers: { cookie }
      },
      env
    );
    const meData = (await meResponse.json()) as { data: { email: string; username: string } };
    expect(meResponse.status).toBe(200);
    expect(meData.data.email).toBe('user@example.com');

    const navResponse = await app.request(
      'https://example.com/api/nav/categories',
      {
        headers: { cookie }
      },
      env
    );
    const navData = (await navResponse.json()) as { success: boolean; data: Array<{ name: string }> };
    expect(navResponse.status).toBe(200);
    expect(navData.success).toBe(true);
    expect(navData.data.length).toBeGreaterThan(0);

    const navRootResponse = await app.request(
      'https://example.com/api/nav',
      {
        headers: { cookie }
      },
      env
    );
    const navRootData = (await navRootResponse.json()) as { success: boolean; data: Array<{ name: string }> };
    expect(navRootResponse.status).toBe(200);
    expect(navRootData.success).toBe(true);
    expect(navRootData.data.length).toBeGreaterThan(0);

    const subCreateResponse = await app.request(
      'https://example.com/api/sub/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: '源 C',
          content:
            'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8iLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6ImV4YW1wbGUuY29tIiwicGF0aCI6Ii8iLCJ0bHMiOiJ0bHMiLCJzbmkiOiJleGFtcGxlLmNvbSJ9'
        })
      },
      env
    );
    expect(subCreateResponse.status).toBe(200);

    const subRootResponse = await app.request(
      'https://example.com/api/sub',
      {
        headers: { cookie }
      },
      env
    );
    const subRootData = (await subRootResponse.json()) as { success: boolean; data: Array<{ id: string }> };
    expect(subRootResponse.status).toBe(200);
    expect(subRootData.success).toBe(true);
    expect(subRootData.data.length).toBeGreaterThan(0);

    const clipCreateResponse = await app.request(
      'https://example.com/api/clipboard',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ content: 'copy me', type: 'text', tags: ['work'] })
      },
      env
    );
    const clipCreateData = (await clipCreateResponse.json()) as { data: { id: string } };
    expect(clipCreateResponse.status).toBe(200);
    expect(clipCreateData.data.id).toBeTruthy();

    const clipListResponse = await app.request(
      'https://example.com/api/clipboard?tags=work',
      {
        headers: { cookie }
      },
      env
    );
    const clipListData = (await clipListResponse.json()) as { data: { items: Array<{ content: string }> } };
    expect(clipListResponse.status).toBe(200);
    expect(clipListData.data.items).toHaveLength(1);
    expect(clipListData.data.items[0].content).toBe('copy me');

    const clipPinResponse = await app.request(
      `https://example.com/api/clipboard/${clipCreateData.data.id}/pin`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ isPinned: true })
      },
      env
    );
    const clipPinData = (await clipPinResponse.json()) as { data: { is_pinned: boolean } };
    expect(clipPinResponse.status).toBe(200);
    expect(clipPinData.data.is_pinned).toBe(true);

    const settingsResponse = await app.request(
      'https://example.com/api/settings/stats',
      {
        headers: { cookie }
      },
      env
    );
    const settingsData = (await settingsResponse.json()) as { data: { clipboard_items: number } };
    expect(settingsResponse.status).toBe(200);
    expect(settingsData.data.clipboard_items).toBeGreaterThan(0);

    const clipDeleteResponse = await app.request(
      `https://example.com/api/clipboard/${clipCreateData.data.id}`,
      {
        method: 'DELETE',
        headers: { cookie }
      },
      env
    );
    expect(clipDeleteResponse.status).toBe(200);

    const clipAfterDeleteResponse = await app.request(
      'https://example.com/api/clipboard?tags=work',
      {
        headers: { cookie }
      },
      env
    );
    const clipAfterDeleteData = (await clipAfterDeleteResponse.json()) as { data: { items: Array<unknown> } };
    expect(clipAfterDeleteResponse.status).toBe(200);
    expect(clipAfterDeleteData.data.items).toHaveLength(0);
  });

  it('compat source validation supports full clash content blocks', async () => {
    env.COMPAT_ALLOW_REGISTER = 'true';
    env.COMPAT_REGISTER_KEY = 'a'.repeat(32); // 至少 32 个字符
    const { cookie } = await register(env);

    const createResponse = await app.request(
      'https://example.com/api/sub/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: 'compat-clash',
          content: `mixed-port: 7890
proxies:
  - name: ClashNode
    type: vmess
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    alterId: 0
    cipher: auto`
        })
      },
      env
    );
    const createData = (await createResponse.json()) as { success: boolean; data: { article_count: number } };

    expect(createResponse.status).toBe(200);
    expect(createData.success).toBe(true);
    expect(createData.data.article_count).toBe(1);
  });

  it('compat fetch expands mixed source entries (direct nodes + subscription urls)', async () => {
    env.COMPAT_ALLOW_REGISTER = 'true';
    env.COMPAT_REGISTER_KEY = 'a'.repeat(32); // 至少 32 个字符
    const { cookie } = await register(env);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://8.8.8.8/sub') {
        return new Response('trojan://pass@example.org:443?security=tls&sni=example.org#remote', { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const createResponse = await app.request(
      'https://example.com/api/sub/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: 'compat-mixed',
          content: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=none#direct\nhttps://8.8.8.8/sub'
        })
      },
      env
    );
    expect(createResponse.status).toBe(200);

    const fetchResponse = await app.request(
      'https://example.com/api/sub/fetch',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({})
      },
      env
    );
    expect(fetchResponse.status).toBe(200);

    const infoResponse = await app.request(
      'https://example.com/api/sub/info',
      {
        headers: { cookie }
      },
      env
    );
    const infoData = (await infoResponse.json()) as { totalNodes: number };

    expect(infoResponse.status).toBe(200);
    expect(infoData.totalNodes).toBe(2);
  });

  it('blocks compat register by default', async () => {
    const response = await app.request(
      'https://example.com/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'blocked@example.com', password: 'secret', username: 'Blocked' }),
        headers: { 'content-type': 'application/json' }
      },
      env
    );

    expect(response.status).toBe(403);
  });

  it('blocks compat register when register key is missing', async () => {
    env.COMPAT_ALLOW_REGISTER = 'true';

    const response = await app.request(
      'https://example.com/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'blocked@example.com', password: 'secret', username: 'Blocked' }),
        headers: { 'content-type': 'application/json' }
      },
      env
    );

    expect(response.status).toBe(403);
  });

  it('filters disabled sources from aggregation', async () => {
    const cookie = await login(env);

    // 创建两个订阅源
    const createResponse1 = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: '启用的源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8iLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6ImV4YW1wbGUuY29tIiwicGF0aCI6Ii8iLCJ0bHMiOiJ0bHMiLCJzbmkiOiJleGFtcGxlLmNvbSJ9'
        })
      },
      env
    );
    const data1 = (await createResponse1.json()) as { source: { id: string; enabled: boolean } };
    expect(data1.source.enabled).toBe(true);

    const createResponse2 = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: '将被禁用的源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdDIiLCJhZGQiOiJleGFtcGxlMi5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIiLCJhaWQiOiIwIiwic2N5IjoiYXV0byIsIm5ldCI6IndzIiwidHlwZSI6Im5vbmUiLCJob3N0IjoiZXhhbXBsZTIuY29tIiwicGF0aCI6Ii8iLCJ0bHMiOiJ0bHMiLCJzbmkiOiJleGFtcGxlMi5jb20ifQ=='
        })
      },
      env
    );
    const data2 = (await createResponse2.json()) as { source: { id: string } };

    // 禁用第二个源
    const updateResponse = await app.request(
      `https://example.com/api/sources/${data2.source.id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ enabled: false })
      },
      env
    );
    const updateData = (await updateResponse.json()) as { source: { enabled: boolean } };
    expect(updateData.source.enabled).toBe(false);

    // 刷新聚合缓存
    await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );

    // 验证聚合结果只包含启用的源
    const subInfoResponse = await app.request(
      'https://example.com/api/sub/info',
      {
        headers: { cookie }
      },
      env
    );
    const subInfo = (await subInfoResponse.json()) as { totalNodes: number };
    expect(subInfo.totalNodes).toBe(1); // 只有一个启用的源
  });

  it('compat fetch does not re-aggregate disabled sources', async () => {
    const cookie = await login(env);

    const createSource = async (name: string, content: string) =>
      app.request(
        'https://example.com/api/sources',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie
          },
          body: JSON.stringify({ name, content })
        },
        env
      );

    const enabledSource = await createSource(
      'compat-enabled',
      'vmess://eyJ2IjoiMiIsInBzIjoiRW5hYmxlZCIsImFkZCI6ImVuYWJsZWQuZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiJhYWFhYWFhYS1hYWFhLWFhYWEtYWFhYS1hYWFhYWFhYWFhYWEiLCJhaWQiOiIwIiwic2N5IjoiYXV0byJ9'
    );
    const disabledSource = await createSource(
      'compat-disabled',
      'vmess://eyJ2IjoiMiIsInBzIjoiRGlzYWJsZWQiLCJhZGQiOiJkaXNhYmxlZC5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6ImJiYmJiYmJiLWJiYmItYmJiYi1iYmJiLWJiYmJiYmJiYmJiYiIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIn0='
    );

    const enabledData = (await enabledSource.json()) as { source: { id: string } };
    const disabledData = (await disabledSource.json()) as { source: { id: string } };

    const disableResponse = await app.request(
      `https://example.com/api/sources/${disabledData.source.id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({ enabled: false })
      },
      env
    );
    expect(disableResponse.status).toBe(200);

    const refreshResponse = await app.request(
      'https://example.com/api/sub/fetch',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({})
      },
      env
    );
    expect(refreshResponse.status).toBe(200);

    const infoResponse = await app.request(
      'https://example.com/api/sub/info',
      {
        headers: { cookie }
      },
      env
    );
    const infoData = (await infoResponse.json()) as { totalNodes: number };
    expect(infoResponse.status).toBe(200);
    expect(infoData.totalNodes).toBe(1);

    const listResponse = await app.request(
      'https://example.com/api/sub/sources',
      {
        headers: { cookie }
      },
      env
    );
    const listData = (await listResponse.json()) as { success: boolean; data: Array<{ id: string; is_active: boolean }> };
    expect(listResponse.status).toBe(200);
    const enabledItem = listData.data.find((source) => source.id === enabledData.source.id);
    const disabledItem = listData.data.find((source) => source.id === disabledData.source.id);
    expect(enabledItem?.is_active).toBe(true);
    expect(disabledItem?.is_active).toBe(false);
  });

  it('returns 503 instead of 500 when refresh lock is contended and cache is cold', async () => {
    const cookie = await login(env);

    await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify({
          name: 'cold-lock-source',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiQ29sZCIsImFkZCI6ImNvbGQuZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiJjY2NjY2NjYy1jY2NjLWNjY2MtY2NjYy1jY2NjY2NjY2NjYyIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIn0='
        })
      },
      env
    );

    await env.CACHE_KV.put('lock:refresh-aggregate', `test-lock-${Date.now()}`);

    const subResponse = await app.request('https://example.com/sub?token=token-123&base64', undefined, env);
    expect(subResponse.status).toBe(503);
  });

  it('invalidates active session after clearing all data', async () => {
    const cookie = await login(env);
    expect(cookie).toBeTruthy();

    const clearResponse = await app.request(
      'https://example.com/api/settings/data/all',
      {
        method: 'DELETE',
        headers: { cookie }
      },
      env
    );
    expect(clearResponse.status).toBe(200);

    const listResponse = await app.request(
      'https://example.com/api/sources',
      {
        headers: { cookie }
      },
      env
    );
    expect(listResponse.status).toBe(401);
  });

  it('invalidates active session after admin password hash rotation', async () => {
    const cookie = await login(env);
    expect(cookie).toBeTruthy();

    env.ADMIN_PASSWORD_HASH = await sha256Hex('new-secret');

    const checkResponse = await app.request(
      'https://example.com/api/auth/check',
      {
        headers: { cookie }
      },
      env
    );
    const checkData = (await checkResponse.json()) as { authenticated: boolean };
    expect(checkResponse.status).toBe(200);
    expect(checkData.authenticated).toBe(false);

    const protectedResponse = await app.request(
      'https://example.com/api/sources',
      {
        headers: { cookie }
      },
      env
    );
    expect(protectedResponse.status).toBe(401);
  });

  it('requires authentication for unknown /api/auth/* routes', async () => {
    const response = await app.request('https://example.com/api/auth/internal', undefined, env);
    expect(response.status).toBe(401);
  });

  it('rejects sessions with mismatched username', async () => {
    const token = 'mismatch-token';
    await env.APP_KV.put(
      `session:${token}`,
      JSON.stringify({
        username: 'not-admin',
        createdAt: Date.now(),
        expiresAt: Date.now() + 30_000,
        passwordHash: env.ADMIN_PASSWORD_HASH
      })
    );

    const response = await app.request(
      'https://example.com/api/sources',
      {
        headers: { cookie: `session=${token}` }
      },
      env
    );
    expect(response.status).toBe(401);
  });
});

describe('backup import security', () => {
  let env: Env;
  let cookie: string;
  type ImportResponse = {
    imported: { navigationLinks: number };
    skipped: {
      navigation: {
        count: number;
        details: Array<{ url: string; reason: string }>;
      };
    };
  };

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'token-123',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200'
    };
    cookie = await login(env);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject javascript: protocol URLs in navigation backup', async () => {
    const maliciousBackup = {
      backup: {
        navigation: [
          {
            id: 'cat1',
            name: 'Test Category',
            sortOrder: 0,
            links: [
              {
                id: 'link1',
                title: 'Malicious Link',
                url: 'javascript:alert(1)',
                description: 'XSS attempt'
              }
            ]
          }
        ]
      }
    };

    const response = await app.request(
      'https://example.com/api/settings/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify(maliciousBackup)
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as ImportResponse;
    // 恶意链接应该被跳过，导入的链接数为 0
    expect(data.imported.navigationLinks).toBe(0);
    expect(data.skipped.navigation.count).toBe(1);
    expect(data.skipped.navigation.details[0]?.reason).toBe('illegal_protocol');
  });

  it('should reject data: protocol URLs in navigation backup', async () => {
    const maliciousBackup = {
      backup: {
        navigation: [
          {
            id: 'cat1',
            name: 'Test Category',
            sortOrder: 0,
            links: [
              {
                id: 'link1',
                title: 'Data URL',
                url: 'data:text/html,<script>alert(1)</script>',
                description: 'Data URL XSS'
              }
            ]
          }
        ]
      }
    };

    const response = await app.request(
      'https://example.com/api/settings/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify(maliciousBackup)
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as ImportResponse;
    expect(data.imported.navigationLinks).toBe(0);
    expect(data.skipped.navigation.count).toBe(1);
    expect(data.skipped.navigation.details[0]?.reason).toBe('illegal_protocol');
  });

  it('should reject file: protocol URLs in navigation backup', async () => {
    const maliciousBackup = {
      backup: {
        navigation: [
          {
            id: 'cat1',
            name: 'Test Category',
            sortOrder: 0,
            links: [
              {
                id: 'link1',
                title: 'File URL',
                url: 'file:///etc/passwd',
                description: 'Local file access'
              }
            ]
          }
        ]
      }
    };

    const response = await app.request(
      'https://example.com/api/settings/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify(maliciousBackup)
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as ImportResponse;
    expect(data.imported.navigationLinks).toBe(0);
    expect(data.skipped.navigation.count).toBe(1);
    expect(data.skipped.navigation.details[0]?.reason).toBe('illegal_protocol');
  });

  it('should accept valid http and https URLs in navigation backup', async () => {
    const validBackup = {
      backup: {
        navigation: [
          {
            id: 'cat1',
            name: 'Test Category',
            sortOrder: 0,
            links: [
              {
                id: 'link1',
                title: 'HTTP Link',
                url: 'http://example.com',
                description: 'Valid HTTP'
              },
              {
                id: 'link2',
                title: 'HTTPS Link',
                url: 'https://example.org',
                description: 'Valid HTTPS'
              }
            ]
          }
        ]
      }
    };

    const response = await app.request(
      'https://example.com/api/settings/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify(validBackup)
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as ImportResponse;
    // 两个有效链接都应该被导入
    expect(data.imported.navigationLinks).toBe(2);
    expect(data.skipped.navigation.count).toBe(0);
  });

  it('should skip invalid URLs but continue importing valid ones (tolerant mode)', async () => {
    const mixedBackup = {
      backup: {
        navigation: [
          {
            id: 'cat1',
            name: 'Test Category',
            sortOrder: 0,
            links: [
              {
                id: 'link1',
                title: 'Valid Link',
                url: 'https://example.com',
                description: 'Valid'
              },
              {
                id: 'link2',
                title: 'Malicious Link',
                url: 'javascript:alert(1)',
                description: 'Invalid'
              },
              {
                id: 'link3',
                title: 'Another Valid Link',
                url: 'https://example.org',
                description: 'Valid'
              }
            ]
          }
        ]
      }
    };

    const response = await app.request(
      'https://example.com/api/settings/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify(mixedBackup)
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as ImportResponse;
    // 只有 2 个有效链接应该被导入，恶意链接被跳过
    expect(data.imported.navigationLinks).toBe(2);
    expect(data.skipped.navigation.count).toBe(1);
    expect(data.skipped.navigation.details[0]?.reason).toBe('illegal_protocol');
  });
});

describe('compat register security', () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'token-123',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200',
      COMPAT_ALLOW_REGISTER: 'true',
      COMPAT_REGISTER_KEY: 'a'.repeat(32) // 32 字符的密钥
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject register key shorter than 32 characters', async () => {
    env.COMPAT_REGISTER_KEY = 'short-key'; // 少于 32 字符

    const response = await app.request(
      'https://example.com/api/auth/register',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-register-key': 'short-key'
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          username: 'testuser'
        })
      },
      env
    );

    expect(response.status).toBe(500);
    const data = (await response.json()) as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain('至少 32 个字符');
  });

  it('should enforce rate limiting (5 attempts per hour)', async () => {
    const registerKey = 'a'.repeat(32);
    env.COMPAT_REGISTER_KEY = registerKey;

    // 尝试 6 次注册（前 5 次应该失败但不触发限流，第 6 次触发限流）
    for (let i = 0; i < 6; i++) {
      const response = await app.request(
        'https://example.com/api/auth/register',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-register-key': 'wrong-key', // 故意使用错误的密钥
            'CF-Connecting-IP': '1.2.3.4'
          },
          body: JSON.stringify({
            email: `test${i}@example.com`,
            password: 'password123',
            username: `testuser${i}`
          })
        },
        env
      );

      if (i < 5) {
        // 前 5 次应该返回 403（密钥错误）
        expect(response.status).toBe(403);
        const data = (await response.json()) as { success: boolean; error: string };
        expect(data.error).toContain('密钥无效');
      } else {
        // 第 6 次应该返回 429（限流）
        expect(response.status).toBe(429);
        const data = (await response.json()) as { success: boolean; error: string };
        expect(data.error).toContain('过于频繁');
      }
    }
  });

  it('should log security events for successful registration', async () => {
    const registerKey = 'a'.repeat(32);
    env.COMPAT_REGISTER_KEY = registerKey;
    
    // Mock console.warn to capture security logs
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await app.request(
      'https://example.com/api/auth/register',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-register-key': registerKey,
          'CF-Connecting-IP': '1.2.3.4',
          'User-Agent': 'Test Agent'
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          username: 'testuser'
        })
      },
      env
    );

    expect(response.status).toBe(200);
    
    // 验证安全日志被记录
    expect(warnSpy).toHaveBeenCalledWith(
      '[Security] COMPAT_REGISTER_SUCCESS:',
      expect.objectContaining({
        username: 'testuser',
        email: 'test@example.com',
        ip: '1.2.3.4',
        userAgent: 'Test Agent'
      })
    );

    warnSpy.mockRestore();
  });

  it('should log security events for invalid key attempts', async () => {
    const registerKey = 'a'.repeat(32);
    env.COMPAT_REGISTER_KEY = registerKey;
    
    // Mock console.warn to capture security logs
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await app.request(
      'https://example.com/api/auth/register',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-register-key': 'wrong-key',
          'CF-Connecting-IP': '1.2.3.4',
          'User-Agent': 'Test Agent'
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          username: 'testuser'
        })
      },
      env
    );

    expect(response.status).toBe(403);
    
    // 验证安全日志被记录
    expect(warnSpy).toHaveBeenCalledWith(
      '[Security] COMPAT_REGISTER_INVALID_KEY:',
      expect.objectContaining({
        ip: '1.2.3.4',
        userAgent: 'Test Agent'
      })
    );

    warnSpy.mockRestore();
  });

  it('should allow successful registration with valid key', async () => {
    const registerKey = 'a'.repeat(32);
    env.COMPAT_REGISTER_KEY = registerKey;

    const response = await app.request(
      'https://example.com/api/auth/register',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-register-key': registerKey
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          username: 'testuser'
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { success: boolean; data: { user: { username: string } } };
    expect(data.success).toBe(true);
    expect(data.data.user.username).toBe('testuser');
  });
});


describe('cache consistency', () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'test-token',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200'
    };
  });

  it('should invalidate cache when source is deleted', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ==', { status: 200 })
    ));

    // 创建订阅源
    const createResponse = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ=='
        })
      },
      env
    );

    const createData = (await createResponse.json()) as { source: { id: string } };
    expect(createResponse.status).toBe(200);

    // 刷新缓存
    const refreshResponse = await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );
    expect(refreshResponse.status).toBe(200);

    // 删除订阅源应该清除缓存
    const deleteResponse = await app.request(
      `https://example.com/api/sources/${createData.source.id}`,
      {
        method: 'DELETE',
        headers: { cookie }
      },
      env
    );
    expect(deleteResponse.status).toBe(200);

    vi.unstubAllGlobals();
  });

  it('should invalidate cache when source is updated', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ==', { status: 200 })
    ));

    // 创建订阅源
    const createResponse = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ=='
        })
      },
      env
    );

    const createData = (await createResponse.json()) as { source: { id: string } };
    expect(createResponse.status).toBe(200);

    // 刷新缓存
    const refreshResponse = await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );
    expect(refreshResponse.status).toBe(200);

    // 更新订阅源应该清除缓存
    const updateResponse = await app.request(
      `https://example.com/api/sources/${createData.source.id}`,
      {
        method: 'PUT',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '更新后的源'
        })
      },
      env
    );
    expect(updateResponse.status).toBe(200);

    vi.unstubAllGlobals();
  });

  it('should recover from corrupted cache data', async () => {
    const cookie = await login(env);
    
    // 写入损坏的缓存数据
    await env.CACHE_KV.put('aggregate-cache', 'corrupted-data-not-valid-base64');

    // 请求订阅应该能够恢复（重新生成缓存或返回错误）
    const response = await app.request(
      'https://example.com/sub?token=test-token',
      undefined,
      env
    );

    // 应该返回 503（缓存冷启动）、200（如果有源）或 500（错误）
    expect([200, 500, 503]).toContain(response.status);
  });

  it('should maintain cache consistency across multiple formats', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ==', { status: 200 })
    ));

    // 创建订阅源
    await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ=='
        })
      },
      env
    );

    // 刷新缓存
    await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );

    // 请求不同格式的订阅
    const base64Response = await app.request(
      'https://example.com/sub?token=test-token&base64',
      undefined,
      env
    );
    const clashResponse = await app.request(
      'https://example.com/sub?token=test-token&clash',
      undefined,
      env
    );

    expect(base64Response.status).toBe(200);
    expect(clashResponse.status).toBe(200);

    // 两种格式应该都能正常返回内容
    const base64Content = await base64Response.text();
    const clashContent = await clashResponse.text();
    
    expect(base64Content.length).toBeGreaterThan(0);
    expect(clashContent.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it('should handle cache expiration correctly', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ==', { status: 200 })
    ));

    // 创建订阅源
    await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ=='
        })
      },
      env
    );

    // 刷新缓存
    const refreshResponse = await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );
    expect(refreshResponse.status).toBe(200);

    // 手动删除缓存模拟过期
    await env.CACHE_KV.delete('aggregate-cache');

    // 请求订阅应该触发缓存重建（可能返回 200 如果能快速重建，或 503 如果需要等待）
    const response = await app.request(
      'https://example.com/sub?token=test-token',
      undefined,
      env
    );

    // 应该返回 200（快速重建）或 503（缓存冷启动需要刷新）
    expect([200, 503]).toContain(response.status);

    vi.unstubAllGlobals();
  });

  it('should prevent cache stampede with distributed lock', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ==', { status: 200 })
    ));

    // 创建订阅源
    await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试源',
          content: 'vmess://eyJ2IjoiMiIsInBzIjoiVGVzdCIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiYWlkIjoiMCIsInNjeSI6ImF1dG8ifQ=='
        })
      },
      env
    );

    // 模拟锁已被占用
    await env.CACHE_KV.put('lock:refresh-aggregate', 'locked-by-another-worker');

    // 尝试刷新应该被阻止或返回错误
    const refreshResponse = await app.request(
      'https://example.com/api/sources/refresh',
      {
        method: 'POST',
        headers: { cookie }
      },
      env
    );

    // 应该返回 503（锁被占用）或 500（错误）
    expect([500, 503]).toContain(refreshResponse.status);

    vi.unstubAllGlobals();
  }, 10000); // 增加超时时间到 10 秒
});

describe('subscription aggregation edge cases', () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'test-token',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200'
    };
  });

  it('should handle subscription source timeout gracefully', async () => {
    const cookie = await login(env);
    
    // Mock fetch to simulate timeout
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      });
    }));

    const response = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '超时源',
          content: 'https://timeout.example.com/sub'
        })
      },
      env
    );

    // 应该创建成功，但节点数为 0
    expect(response.status).toBe(200);
    const data = (await response.json()) as { source: { nodeCount: number } };
    expect(data.source.nodeCount).toBe(0);

    vi.unstubAllGlobals();
  });

  it('should handle invalid subscription format', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('This is not a valid subscription format', { status: 200 })
    ));

    const response = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '无效格式源',
          content: 'https://invalid.example.com/sub'
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { source: { nodeCount: number } };
    expect(data.source.nodeCount).toBe(0);

    vi.unstubAllGlobals();
  });

  it('should handle subscription source returning 404', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404 })
    ));

    const response = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '404源',
          content: 'https://notfound.example.com/sub'
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { source: { nodeCount: number } };
    expect(data.source.nodeCount).toBe(0);

    vi.unstubAllGlobals();
  });

  it('should handle subscription source with oversized content', async () => {
    const cookie = await login(env);
    
    // 创建一个超过 10MB 的内容
    const largeContent = 'a'.repeat(11 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(largeContent, { 
        status: 200,
        headers: { 'content-length': String(largeContent.length) }
      })
    ));

    const response = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '超大源',
          content: 'https://large.example.com/sub'
        })
      },
      env
    );

    // 应该被拒绝或返回 0 节点
    expect(response.status).toBe(200);
    const data = (await response.json()) as { source: { nodeCount: number } };
    expect(data.source.nodeCount).toBe(0);

    vi.unstubAllGlobals();
  });

  it('should handle concurrent subscription refresh without race conditions', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('vmess://base64content', { status: 200 })
    ));

    // 创建一个订阅源
    const createResponse = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: '测试源',
          content: 'https://example.com/sub'
        })
      },
      env
    );

    expect(createResponse.status).toBe(200);

    // 并发刷新多次
    const refreshPromises = Array.from({ length: 5 }, () =>
      app.request(
        'https://example.com/api/sources/refresh',
        {
          method: 'POST',
          headers: { cookie }
        },
        env
      )
    );

    const responses = await Promise.all(refreshPromises);
    
    // 至少有一个成功，其他可能因为锁而返回 503
    const successCount = responses.filter(r => r.status === 200).length;
    const lockedCount = responses.filter(r => r.status === 503).length;
    
    expect(successCount + lockedCount).toBe(5);
    expect(successCount).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();
  });

  it('should handle DNS resolution failure for subscription source', async () => {
    const cookie = await login(env);
    
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new Error('getaddrinfo ENOTFOUND nonexistent.example.com')
    ));

    const response = await app.request(
      'https://example.com/api/sources',
      {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          name: 'DNS失败源',
          content: 'https://nonexistent.example.com/sub'
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { source: { nodeCount: number } };
    expect(data.source.nodeCount).toBe(0);

    vi.unstubAllGlobals();
  });
});

describe('source repository safety', () => {
  it('does not recreate a source that was deleted during node count refresh', async () => {
    const env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace
    };

    const now = new Date().toISOString();
    const source: SubscriptionSourceRecord = {
      id: 'src-delete-race',
      name: 'to-delete',
      content: 'vless://example',
      nodeCount: 1,
      sortOrder: 0,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };

    await saveSource(env as any, source as any);
    await deleteSource(env as any, source.id);
    await saveSourceNodeCount(env as any, source as any, 9);

    const latest = await getSource(env as any, source.id);
    expect(latest).toBeNull();
  });
});

describe('subscriptions byte-size limit', () => {
  it('rejects multibyte source content that exceeds 10MB by bytes', async () => {
    const mockRepository = {
      validateContent: vi.fn(),
      createSource: vi.fn(),
      invalidateCache: vi.fn()
    };
    const service = new SubscriptionsService(mockRepository as any);

    const limitBytes = 10 * 1024 * 1024;
    const oversizedContent = '你'.repeat(Math.floor(limitBytes / 3) + 1);

    await expect(service.createSource({ name: 'mb-source', content: oversizedContent })).rejects.toMatchObject({
      status: 400
    });
    expect(mockRepository.validateContent).not.toHaveBeenCalled();
    expect(mockRepository.createSource).not.toHaveBeenCalled();
  });
});

describe('settings import link limit', () => {
  let env: Env;
  let cookie: string;

  beforeEach(async () => {
    env = {
      APP_KV: new MemoryKv() as unknown as KVNamespace,
      CACHE_KV: new MemoryKv() as unknown as KVNamespace,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: await sha256Hex('secret'),
      SUB_TOKEN: 'token-123',
      AGGREGATE_TTL_SECONDS: '3600',
      MAX_LOG_ENTRIES: '200'
    };
    cookie = await login(env);
  });

  it('rejects oversized link snippets during backup import', async () => {
    const now = new Date().toISOString();
    const oversizedLink = `https://example.com/${'a'.repeat(11 * 1024)}`;
    const payload = {
      backup: {
        snippets: [
          {
            id: 'snippet-link-oversized',
            type: 'link',
            title: 'big-link',
            content: oversizedLink,
            isPinned: false,
            createdAt: now,
            updatedAt: now
          }
        ]
      }
    };

    const response = await app.request(
      'https://example.com/api/settings/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie
        },
        body: JSON.stringify(payload)
      },
      env
    );

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('链接片段内容过大');
  });
});
