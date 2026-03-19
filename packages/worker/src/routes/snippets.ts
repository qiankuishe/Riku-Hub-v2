import type { Hono } from 'hono';
import { SnippetsController } from '../controllers/snippets-controller';
import { SnippetsRepository } from '../repositories/snippets-repository';
import { SnippetsService } from '../services/snippets-service';
import type { SnippetsRepositoryDeps } from '../types/snippets';

interface SnippetsRouteOptions<TEnv extends object> {
  deps: SnippetsRepositoryDeps<TEnv>;
}

export function mountSnippetsRoutes<TEnv extends object>(
  app: Hono<any>,
  options: SnippetsRouteOptions<TEnv>
): void {
  const controller = new SnippetsController<TEnv>(
    (env) => new SnippetsService(new SnippetsRepository(env, options.deps))
  );

  app.get('/api/snippets', (c) => controller.listSnippets(c));
  app.post('/api/snippets', (c) => controller.createSnippet(c));
  app.put('/api/snippets/:id', (c) => controller.updateSnippet(c));
  app.delete('/api/snippets/:id', (c) => controller.deleteSnippet(c));
}

