export interface AuthBindings {
  APP_KV: KVNamespace;
  DB?: D1Database;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
}

export interface AuthSession {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

export interface LoginAttemptState {
  count: number;
  lastAttempt: number;
  lockedUntil: number;
  lockLevel: number;
}

export interface AuthLoginInput {
  username?: string;
  email?: string;
  password?: string;
}

export type AuthLoginResult =
  | {
      ok: true;
      token: string;
      username: string;
    }
  | {
      ok: false;
      status: 401 | 429;
      error: string;
    };

