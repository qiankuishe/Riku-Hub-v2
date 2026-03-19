import type { Hono } from 'hono';
import { SubscriptionsController } from '../controllers/subscriptions-controller';
import { SubscriptionsRepository } from '../repositories/subscriptions-repository';
import { SubscriptionsService } from '../services/subscriptions-service';
import type { SubscriptionsRepositoryDeps } from '../types/subscriptions';

interface SubscriptionsRouteOptions<TEnv extends object> {
  deps: SubscriptionsRepositoryDeps<TEnv>;
  appendLog: (env: TEnv, action: string, detail?: string) => Promise<void>;
}

export function mountSubscriptionsRoutes<TEnv extends object>(
  app: Hono<any>,
  options: SubscriptionsRouteOptions<TEnv>
): void {
  const controller = new SubscriptionsController<TEnv>(
    (env) => new SubscriptionsService(new SubscriptionsRepository(env, options.deps)),
    options.appendLog
  );

  app.get('/api/sources', (c) => controller.listSources(c));
  app.get('/api/sources/:id', (c) => controller.getSource(c));
  app.post('/api/sources/validate', (c) => controller.validateSource(c));
  app.post('/api/sources', (c) => controller.createSource(c));
  app.put('/api/sources/reorder', (c) => controller.reorderSources(c));
  app.put('/api/sources/:id', (c) => controller.updateSource(c));
  app.delete('/api/sources/:id', (c) => controller.deleteSource(c));
  app.post('/api/sources/refresh', (c) => controller.refreshSources(c));
  app.get('/sub', (c) => controller.subscription(c));
}
