import type { Hono } from 'hono';
import { NavigationController } from '../controllers/navigation-controller';
import { NavigationRepository } from '../repositories/navigation-repository';
import { NavigationService } from '../services/navigation-service';
import type { NavigationRepositoryDeps } from '../types/navigation';

interface NavigationRouteOptions<TEnv> {
  deps: NavigationRepositoryDeps<TEnv>;
  appendLog: (env: TEnv, action: string, detail?: string) => Promise<void>;
}

export function mountNavigationRoutes<TEnv extends object>(app: Hono<any>, options: NavigationRouteOptions<TEnv>): void {
  const controller = new NavigationController<TEnv>(
    (env) => new NavigationService(new NavigationRepository(env, options.deps)),
    options.appendLog
  );

  app.get('/api/navigation', (c) => controller.overview(c));
  app.post('/api/navigation/categories', (c) => controller.createCategory(c));
  app.put('/api/navigation/categories/reorder', (c) => controller.reorderCategories(c));
  app.put('/api/navigation/categories/:id', (c) => controller.updateCategory(c));
  app.delete('/api/navigation/categories/:id', (c) => controller.deleteCategory(c));
  app.post('/api/navigation/links', (c) => controller.createLink(c));
  app.post('/api/navigation/links/:id/visit', (c) => controller.visitLink(c));
  app.put('/api/navigation/links/reorder', (c) => controller.reorderLinks(c));
  app.put('/api/navigation/links/:id', (c) => controller.updateLink(c));
  app.delete('/api/navigation/links/:id', (c) => controller.deleteLink(c));
}
