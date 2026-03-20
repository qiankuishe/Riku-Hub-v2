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
      // 1. 环境变量强制校验
      if (!isEnabledFlag(c.env.COMPAT_ALLOW_REGISTER)) {
        throw new CompatHttpError(403, {
          success: false,
          error: '兼容注册接口默认关闭，请在环境变量中设置 COMPAT_ALLOW_REGISTER=true 后重试'
        });
      }

      // 2. 密钥强度校验
      const requiredRegisterKey = c.env.COMPAT_REGISTER_KEY?.trim();
      if (!requiredRegisterKey) {
        throw new CompatHttpError(403, {
          success: false,
          error: '兼容注册需要设置 COMPAT_REGISTER_KEY，未配置时禁止开放注册'
        });
      }
      
      if (requiredRegisterKey.length < 32) {
        throw new CompatHttpError(500, {
          success: false,
          error: 'COMPAT_REGISTER_KEY 长度必须至少 32 个字符，请联系管理员'
        });
      }

      // 3. IP 限流检查（5 次/小时）
      const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
      const rateLimitKey = `rate_limit:compat_register:${clientIp}`;
      const rateLimitWindow = 3600; // 1 hour in seconds
      const rateLimitMax = 5;
      
      const currentCount = await getRateLimitCount(c.env.CACHE_KV, rateLimitKey);
      if (currentCount >= rateLimitMax) {
        // 审计日志：限流触发
        await logSecurityEvent(c.env, {
          type: 'COMPAT_REGISTER_RATE_LIMIT',
          ip: clientIp,
          userAgent: c.req.header('User-Agent') || 'unknown',
          timestamp: Date.now()
        });
        
        throw new CompatHttpError(429, {
          success: false,
          error: '注册请求过于频繁，请 1 小时后重试'
        });
      }

      // 4. 密钥验证
      const service = this.serviceFor(c.env);
      const body = await readJson<CompatRegisterInput>(c.req.raw);
      const providedRegisterKey = body.register_key?.trim() || body.registerKey?.trim() || c.req.header('x-register-key')?.trim() || '';
      
      if (providedRegisterKey !== requiredRegisterKey) {
        // 审计日志：密钥错误
        await logSecurityEvent(c.env, {
          type: 'COMPAT_REGISTER_INVALID_KEY',
          ip: clientIp,
          userAgent: c.req.header('User-Agent') || 'unknown',
          timestamp: Date.now()
        });
        
        // 增加限流计数
        await incrementRateLimitCount(c.env.CACHE_KV, rateLimitKey, rateLimitWindow);
        
        throw new CompatHttpError(403, {
          success: false,
          error: '注册密钥无效，请在请求体 register_key 或请求头 x-register-key 中提供正确密钥'
        });
      }

      // 5. 执行注册
      const result = await service.register(body);

      // 6. 审计日志：注册成功
      await logSecurityEvent(c.env, {
        type: 'COMPAT_REGISTER_SUCCESS',
        username: result.user.username,
        email: result.user.email,
        ip: clientIp,
        userAgent: c.req.header('User-Agent') || 'unknown',
        timestamp: Date.now()
      });

      // 7. 增加限流计数（成功也计数，防止暴力注册）
      await incrementRateLimitCount(c.env.CACHE_KV, rateLimitKey, rateLimitWindow);

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

async function getRateLimitCount(kv: KVNamespace, key: string): Promise<number> {
  const value = await kv.get(key);
  return value ? Number.parseInt(value, 10) || 0 : 0;
}

async function incrementRateLimitCount(kv: KVNamespace, key: string, ttlSeconds: number): Promise<void> {
  const current = await getRateLimitCount(kv, key);
  await kv.put(key, String(current + 1), { expirationTtl: ttlSeconds });
}

async function logSecurityEvent(env: CompatBindings, event: {
  type: string;
  username?: string;
  email?: string;
  ip: string;
  userAgent: string;
  timestamp: number;
}): Promise<void> {
  // 记录到日志系统（如果有 D1 数据库）
  if (env.DB) {
    try {
      // 使用 app_logs 表（应用级日志），而不是 logs 表（设置相关日志）
      await env.DB.prepare(
        'INSERT INTO app_logs (id, action, detail, created_at) VALUES (?, ?, ?, ?)'
      ).bind(
        randomToken(16), // 生成唯一 ID
        event.type,
        JSON.stringify({
          username: event.username,
          email: event.email,
          ip: event.ip,
          userAgent: event.userAgent
        }),
        new Date(event.timestamp).toISOString()
      ).run();
    } catch (error) {
      // 日志记录失败不应影响主流程，仅输出到控制台
      console.error('[Security] Failed to log event:', error);
    }
  }
  
  // 同时输出到控制台
  console.warn(`[Security] ${event.type}:`, {
    username: event.username,
    email: event.email,
    ip: event.ip,
    userAgent: event.userAgent,
    timestamp: new Date(event.timestamp).toISOString()
  });
}

// 生成随机 token（用于 ID 生成）
function randomToken(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
