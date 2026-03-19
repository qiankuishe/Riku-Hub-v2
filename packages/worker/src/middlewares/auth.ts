import type { MiddlewareHandler } from 'hono';
import { AuthController } from '../controllers/auth-controller';
import type { AuthBindings } from '../types/auth';

export function createAuthMiddleware(controller: AuthController): MiddlewareHandler<{ Bindings: AuthBindings }> {
  return async (c, next) => controller.ensureAuthenticated(c, next);
}

