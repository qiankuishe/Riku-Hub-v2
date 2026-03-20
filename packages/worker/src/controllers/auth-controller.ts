import type { Context, Next } from 'hono';
import { AuthRepository } from '../repositories/auth-repository';
import { AuthService } from '../services/auth-service';
import type { AuthBindings, AuthLoginInput } from '../types/auth';

type AuthContext = Context<{ Bindings: AuthBindings }>;

export type AuthAppendLog = (env: AuthBindings, action: string, detail?: string) => Promise<void>;

export class AuthController {
  constructor(private readonly appendLog: AuthAppendLog) {}

  async login(c: AuthContext): Promise<Response> {
    const service = this.serviceFor(c.env);
    const body = await readJson<AuthLoginInput>(c.req.raw);
    const ip = getClientIp(c.req.raw);
    const result = await service.login(body, ip, c.req.raw);

    if (result.ok) {
      await this.appendLog(c.env, 'login', `用户 ${result.username} 登录成功`);
      c.header('Set-Cookie', service.createSessionCookie(result.token));
      return c.json({ success: true });
    }

    await this.appendLog(
      c.env,
      result.status === 429 ? 'login_blocked' : 'login_failed',
      result.status === 429
        ? `IP ${ip} 登录受限: ${result.error}`
        : `用户 ${body.username ?? body.email?.split('@')[0] ?? ''} 登录失败，IP: ${ip}`
    );
    return c.json({ error: result.error }, result.status);
  }

  async logout(c: AuthContext): Promise<Response> {
    const service = this.serviceFor(c.env);
    const token = getCookie(c.req.raw, 'session');
    await service.logout(token);
    await this.appendLog(c.env, 'logout', '用户登出');
    c.header('Set-Cookie', service.createLogoutCookie());
    return c.json({ success: true });
  }

  async check(c: AuthContext): Promise<Response> {
    const service = this.serviceFor(c.env);
    const authenticated = await service.isAuthenticated(c.req.raw);
    return c.json({ authenticated });
  }

  async ensureAuthenticated(c: AuthContext, next: Next): Promise<Response | void> {
    const normalizedPath = normalizePath(c.req.path);
    if (PUBLIC_AUTH_PATHS.has(normalizedPath)) {
      await next();
      return;
    }

    const service = this.serviceFor(c.env);
    const session = await service.requireSession(c.req.raw);
    if (!session) {
      return c.json({ error: '未登录或登录已过期' }, 401);
    }
    await next();
  }

  private serviceFor(env: AuthBindings): AuthService {
    return new AuthService(env, new AuthRepository(env));
  }
}

const PUBLIC_AUTH_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/check',
  '/api/auth/register',
  '/api/auth/me'
]);

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
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

function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }
  return path.replace(/\/+$/, '') || '/';
}
