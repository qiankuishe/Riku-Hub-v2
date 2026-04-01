import type { AuthBindings, AuthSession, LoginAttemptState } from '../types/auth';
import { randomToken } from '../utils/runtime';

interface SessionRow {
  token: string;
  username: string;
  created_at: number;
  expires_at: number;
  password_hash: string;
}

interface LoginAttemptRow {
  ip: string;
  count: number;
  last_attempt: number;
  locked_until: number;
  lock_level: number;
  expires_at: number;
}

export class AuthRepository {
  constructor(private readonly env: AuthBindings) {}

  async getSession(token: string): Promise<AuthSession | null> {
    if (!token) {
      return null;
    }

    if (!this.hasD1()) {
      const raw = await this.env.APP_KV.get(this.sessionKey(token), 'json');
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const session = raw as Partial<AuthSession>;
      if (typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) {
        await this.deleteSession(token);
        return null;
      }
      return {
        token,
        username: typeof session.username === 'string' ? session.username : '',
        createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
        expiresAt: session.expiresAt,
        passwordHash: typeof session.passwordHash === 'string' ? session.passwordHash : ''
      };
    }

    const row = await this.getDb()
      .prepare('SELECT token, username, created_at, expires_at, password_hash FROM auth_sessions WHERE token = ?')
      .bind(token)
      .first<SessionRow>();
    if (!row) {
      return null;
    }
    if (row.expires_at <= Date.now()) {
      await this.deleteSession(token);
      return null;
    }
    return {
      token: row.token,
      username: row.username,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      passwordHash: row.password_hash ?? ''
    };
  }

  async createSession(username: string, ttlSeconds: number, passwordHash: string): Promise<AuthSession> {
    const token = randomToken();
    const createdAt = Date.now();
    const expiresAt = createdAt + ttlSeconds * 1000;
    const session: AuthSession = { token, username, createdAt, expiresAt, passwordHash };

    if (this.hasD1()) {
      await this.getDb()
        .prepare('INSERT INTO auth_sessions (token, username, created_at, expires_at, password_hash) VALUES (?, ?, ?, ?, ?)')
        .bind(session.token, session.username, session.createdAt, session.expiresAt, session.passwordHash)
        .run();
      return session;
    }

    await this.env.APP_KV.put(
      this.sessionKey(session.token),
        JSON.stringify({
          username: session.username,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          passwordHash: session.passwordHash
        })
      );
    return session;
  }

  async deleteSession(token: string): Promise<void> {
    if (!token) {
      return;
    }

    if (this.hasD1()) {
      await this.getDb().prepare('DELETE FROM auth_sessions WHERE token = ?').bind(token).run();
      return;
    }

    await this.env.APP_KV.delete(this.sessionKey(token));
  }

  async getLoginAttempt(ip: string): Promise<LoginAttemptState | null> {
    if (!ip) {
      return null;
    }

    if (!this.hasD1()) {
      const raw = await this.env.APP_KV.get(this.loginAttemptKey(ip), 'json');
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const state = raw as Partial<LoginAttemptState & { expiresAt: number }>;
      if (typeof state.expiresAt === 'number' && state.expiresAt <= Date.now()) {
        await this.clearLoginAttempt(ip);
        return null;
      }
      return {
        count: typeof state.count === 'number' ? state.count : 0,
        lastAttempt: typeof state.lastAttempt === 'number' ? state.lastAttempt : 0,
        lockedUntil: typeof state.lockedUntil === 'number' ? state.lockedUntil : 0,
        lockLevel: typeof state.lockLevel === 'number' ? state.lockLevel : 0
      };
    }

    const row = await this.getDb()
      .prepare(
        `SELECT ip, count, last_attempt, locked_until, lock_level, expires_at
         FROM login_attempts
         WHERE ip = ?`
      )
      .bind(ip)
      .first<LoginAttemptRow>();

    if (!row) {
      return null;
    }
    if (row.expires_at <= Date.now()) {
      await this.clearLoginAttempt(ip);
      return null;
    }
    return {
      count: row.count,
      lastAttempt: row.last_attempt,
      lockedUntil: row.locked_until,
      lockLevel: row.lock_level
    };
  }

  async saveLoginAttempt(ip: string, state: LoginAttemptState, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    if (this.hasD1()) {
      await this.getDb()
        .prepare(
          `INSERT INTO login_attempts (ip, count, last_attempt, locked_until, lock_level, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(ip) DO UPDATE SET
             count = excluded.count,
             last_attempt = excluded.last_attempt,
             locked_until = excluded.locked_until,
             lock_level = excluded.lock_level,
             expires_at = excluded.expires_at`
        )
        .bind(ip, state.count, state.lastAttempt, state.lockedUntil, state.lockLevel, expiresAt)
        .run();
      return;
    }

    await this.env.APP_KV.put(
      this.loginAttemptKey(ip),
      JSON.stringify({
        ...state,
        expiresAt
      })
    );
  }

  async clearLoginAttempt(ip: string): Promise<void> {
    if (!ip) {
      return;
    }

    if (this.hasD1()) {
      await this.getDb().prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
      return;
    }

    await this.env.APP_KV.delete(this.loginAttemptKey(ip));
  }

  private hasD1(): boolean {
    return typeof this.env.DB !== 'undefined';
  }

  private getDb(): D1Database {
    if (!this.env.DB) {
      throw new Error('D1 database binding DB is required but missing.');
    }
    return this.env.DB;
  }

  private sessionKey(token: string): string {
    return `session:${token}`;
  }

  private loginAttemptKey(ip: string): string {
    return `login-attempt:${ip}`;
  }
}
