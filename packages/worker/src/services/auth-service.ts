import type { AuthBindings, AuthLoginInput, AuthLoginResult, AuthSession, LoginAttemptState } from '../types/auth';
import { AuthRepository } from '../repositories/auth-repository';

export const SESSION_TTL_SECONDS = 24 * 60 * 60;
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const LOCK_LEVELS = [
  { attempts: 10, durationMs: 5 * 60 * 1000 },
  { attempts: 8, durationMs: 15 * 60 * 1000 },
  { attempts: 5, durationMs: 30 * 60 * 1000 },
  { attempts: 2, durationMs: 60 * 60 * 1000 }
] as const;

export class AuthService {
  constructor(
    private readonly env: AuthBindings,
    private readonly repository: AuthRepository
  ) {}

  async login(input: AuthLoginInput, ip: string): Promise<AuthLoginResult> {
    const username = (input.username ?? input.email?.split('@')[0] ?? '').trim();
    const password = (input.password ?? '').trim();

    const lockState = await this.repository.getLoginAttempt(ip);
    const remainingLockMs = this.getRemainingLockMs(lockState);
    if (remainingLockMs > 0) {
      return {
        ok: false,
        status: 429,
        error: `登录尝试次数过多，请 ${Math.ceil(remainingLockMs / 60000)} 分钟后再试`
      };
    }

    const expectedUser = this.env.ADMIN_USERNAME ?? 'admin';
    const expectedHash = this.env.ADMIN_PASSWORD_HASH ?? '';
    const providedHash = await sha256Hex(password);
    if (username === expectedUser && expectedHash && safeEqual(providedHash, expectedHash)) {
      await this.repository.clearLoginAttempt(ip);
      const session = await this.repository.createSession(username, SESSION_TTL_SECONDS, expectedHash);
      return {
        ok: true,
        token: session.token,
        username: session.username
      };
    }

    const updated = await this.recordFailedAttempt(ip, lockState);
    if (updated.lockedUntil > Date.now()) {
      return {
        ok: false,
        status: 429,
        error: `登录尝试次数过多，请 ${Math.ceil((updated.lockedUntil - Date.now()) / 60000)} 分钟后再试`
      };
    }

    return {
      ok: false,
      status: 401,
      error: `用户名或密码错误，还剩 ${this.getRemainingAttempts(updated)} 次尝试机会`
    };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) {
      return;
    }
    await this.repository.deleteSession(token);
  }

  async requireSession(request: Request): Promise<AuthSession | null> {
    const token = getCookie(request, 'session');
    if (!token) {
      return null;
    }
    const session = await this.repository.getSession(token);
    if (!session) {
      return null;
    }
    const expectedHash = this.env.ADMIN_PASSWORD_HASH ?? '';
    if (expectedHash && session.passwordHash !== expectedHash) {
      await this.repository.deleteSession(session.token);
      return null;
    }
    return session;
  }

  async isAuthenticated(request: Request): Promise<boolean> {
    return Boolean(await this.requireSession(request));
  }

  createSessionCookie(token: string): string {
    return serializeCookie('session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
      secure: true,
      maxAge: SESSION_TTL_SECONDS
    });
  }

  createLogoutCookie(): string {
    return serializeCookie('session', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
      secure: true,
      maxAge: 0
    });
  }

  private getLockConfig(level: number): { attempts: number; durationMs: number } {
    return LOCK_LEVELS[Math.min(level, LOCK_LEVELS.length - 1)];
  }

  private getRemainingLockMs(state: LoginAttemptState | null): number {
    if (!state) {
      return 0;
    }
    return Math.max(state.lockedUntil - Date.now(), 0);
  }

  private getRemainingAttempts(state: LoginAttemptState): number {
    const config = this.getLockConfig(state.lockLevel);
    return Math.max(config.attempts - state.count, 0);
  }

  private async recordFailedAttempt(ip: string, existing: LoginAttemptState | null): Promise<LoginAttemptState> {
    const now = Date.now();
    let state = existing;

    if (!state || now - state.lastAttempt > RESET_AFTER_MS) {
      state = { count: 0, lastAttempt: now, lockedUntil: 0, lockLevel: 0 };
    } else if (state.lockedUntil > 0 && state.lockedUntil <= now) {
      state = { count: 0, lastAttempt: now, lockedUntil: 0, lockLevel: state.lockLevel + 1 };
    }

    state.count += 1;
    state.lastAttempt = now;
    const lockConfig = this.getLockConfig(state.lockLevel);
    if (state.count >= lockConfig.attempts) {
      state.lockedUntil = now + lockConfig.durationMs;
    }

    await this.repository.saveLoginAttempt(ip, state, SESSION_TTL_SECONDS);
    return state;
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

function serializeCookie(
  name: string,
  value: string,
  options: {
    path?: string;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    secure?: boolean;
    maxAge?: number;
  }
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}
