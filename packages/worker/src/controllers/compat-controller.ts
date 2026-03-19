import type { Context } from 'hono';
import { CompatHttpError, CompatService } from '../services/compat-service';
import { CompatRepository } from '../repositories/compat-repository';
import type {
  CompatBindings,
  CompatClipboardCreateInput,
  CompatClipboardListQuery,
  CompatClipboardPinInput,
  CompatRegisterInput,
  CompatSettingsUpdateInput
} from '../types/compat';

const SESSION_TTL_SECONDS = 24 * 60 * 60;

export class CompatController {
  async register(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      if (!isEnabledFlag(c.env.COMPAT_ALLOW_REGISTER)) {
        throw new CompatHttpError(403, {
          success: false,
          error: '兼容注册接口默认关闭，请在环境变量中设置 COMPAT_ALLOW_REGISTER=true 后重试'
        });
      }

      const service = this.serviceFor(c.env);
      const body = await readJson<CompatRegisterInput>(c.req.raw);
      const requiredRegisterKey = c.env.COMPAT_REGISTER_KEY?.trim();
      if (!requiredRegisterKey) {
        throw new CompatHttpError(403, {
          success: false,
          error: '兼容注册需要设置 COMPAT_REGISTER_KEY，未配置时禁止开放注册'
        });
      }
      const providedRegisterKey = body.register_key?.trim() || body.registerKey?.trim() || c.req.header('x-register-key')?.trim() || '';
      if (providedRegisterKey !== requiredRegisterKey) {
        throw new CompatHttpError(403, {
          success: false,
          error: '注册密钥无效，请在请求体 register_key 或请求头 x-register-key 中提供正确密钥'
        });
      }
      const result = await service.register(body);

      c.header('Set-Cookie', serializeSessionCookie(result.token));
      return c.json({
        success: true,
        data: {
          user: result.user
        }
      });
    });
  }

  async me(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const token = getCookie(c.req.raw, 'session');
      const user = await service.getCurrentUser(token);
      return c.json({ success: true, data: user });
    });
  }

  async listClipboard(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const query: CompatClipboardListQuery = {
        page: c.req.query('page'),
        limit: c.req.query('limit'),
        type: c.req.query('type'),
        q: c.req.query('q'),
        tags: c.req.query('tags')
      };
      const data = await service.listClipboard(query);
      return c.json({ success: true, data });
    });
  }

  async createClipboard(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<CompatClipboardCreateInput>(c.req.raw);
      const item = await service.createClipboard(body);
      return c.json({ success: true, data: item });
    });
  }

  async deleteClipboard(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const id = c.req.param('id') ?? '';
      await service.deleteClipboard(id);
      return c.json({ success: true, message: '已删除' });
    });
  }

  async updateClipboardPin(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<CompatClipboardPinInput>(c.req.raw);
      const id = c.req.param('id') ?? '';
      const item = await service.updateClipboardPin(id, body);
      return c.json({ success: true, data: item });
    });
  }

  async getSettings(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.getSettings();
      return c.json({ success: true, data });
    });
  }

  async updateSettings(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<CompatSettingsUpdateInput>(c.req.raw);
      const data = await service.updateSettings(body);
      return c.json({ success: true, message: '设置已更新', data });
    });
  }

  async getSettingsStats(c: Context<{ Bindings: CompatBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.getSettingsStats();
      return c.json({ success: true, data });
    });
  }

  private serviceFor(env: CompatBindings): CompatService {
    return new CompatService(new CompatRepository(env));
  }

  private async handle(c: Context<{ Bindings: CompatBindings }>, handler: () => Promise<Response>): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof CompatHttpError) {
        return new Response(JSON.stringify(error.body), {
          status: error.status,
          headers: {
            'content-type': 'application/json; charset=UTF-8'
          }
        });
      }
      throw error;
    }
  }
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const pair of cookieHeader.split(';')) {
    const [key, value] = pair.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value || '');
    }
  }

  return null;
}

function serializeSessionCookie(token: string): string {
  return [
    `session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Secure',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ].join('; ');
}

function isEnabledFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
