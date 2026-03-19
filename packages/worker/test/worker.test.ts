import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, type Env } from '../src/index';

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
  const response = await app.request(
    'https://example.com/api/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'secret', username: 'User', register_key: 'test-register-key' }),
      headers: {
        'content-type': 'application/json',
        'x-register-key': 'test-register-key'
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
    env.COMPAT_REGISTER_KEY = 'test-register-key';
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
    env.COMPAT_REGISTER_KEY = 'test-register-key';
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
    env.COMPAT_REGISTER_KEY = 'test-register-key';
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
