import type { Hono } from 'hono';
import { AuthController, type AuthAppendLog } from '../controllers/auth-controller';

export function createAuthController(appendLog: AuthAppendLog): AuthController {
  return new AuthController(appendLog);
}

export function mountAuthRoutes(app: Hono<any>, controller: AuthController): void {
  app.post('/api/auth/login', (c) => controller.login(c));
  app.post('/api/auth/logout', (c) => controller.logout(c));
  app.get('/api/auth/check', (c) => controller.check(c));
}

