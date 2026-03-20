import type { MiddlewareHandler } from 'hono';
import { AuthController } from '../controllers/auth-controller';
import type { AuthBindings, AuthVariables } from '../types/auth';

export function createAuthMiddleware(controller: AuthController): MiddlewareHandler<{ Bindings: AuthBindings; Variables: AuthVariables }> {
  return async (c, next) => controller.ensureAuthenticated(c, next);
}

