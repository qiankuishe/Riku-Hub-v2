import type { Hono } from 'hono';
import { CompatController } from '../controllers/compat-controller';
import { CompatNavSubController } from '../controllers/compat-nav-sub-controller';

export function mountCompatRoutes(app: Hono<any>): void {
  const controller = new CompatController();
  const navSubController = new CompatNavSubController();

  app.post('/api/auth/register', (c) => controller.register(c));
  app.get('/api/auth/me', (c) => controller.me(c));

  app.get('/api/clipboard', (c) => controller.listClipboard(c));
  app.post('/api/clipboard', (c) => controller.createClipboard(c));
  app.put('/api/clipboard/:id/pin', (c) => controller.updateClipboardPin(c));
  app.delete('/api/clipboard/:id', (c) => controller.deleteClipboard(c));

  app.get('/api/settings', (c) => controller.getSettings(c));
  app.put('/api/settings', (c) => controller.updateSettings(c));
  app.get('/api/settings/stats', (c) => controller.getSettingsStats(c));

  app.get('/api/nav', (c) => navSubController.nav(c));
  app.get('/api/nav/categories', (c) => navSubController.navCategories(c));
  app.post('/api/nav/categories', (c) => navSubController.createNavCategory(c));
  app.put('/api/nav/categories/reorder', (c) => navSubController.reorderNavCategories(c));
  app.put('/api/nav/categories/:id', (c) => navSubController.updateNavCategory(c));
  app.delete('/api/nav/categories/:id', (c) => navSubController.deleteNavCategory(c));
  app.get('/api/nav/links', (c) => navSubController.listNavLinks(c));
  app.post('/api/nav/links', (c) => navSubController.createNavLink(c));
  app.put('/api/nav/links/reorder', (c) => navSubController.reorderNavLinks(c));
  app.put('/api/nav/links/:id', (c) => navSubController.updateNavLink(c));
  app.delete('/api/nav/links/:id', (c) => navSubController.deleteNavLink(c));
  app.post('/api/nav/links/:id/visit', (c) => navSubController.visitNavLink(c));

  app.get('/api/sub', (c) => navSubController.sub(c));
  app.get('/api/sub/sources', (c) => navSubController.subSources(c));
  app.post('/api/sub/sources', (c) => navSubController.createSubSource(c));
  app.get('/api/sub/articles', (c) => navSubController.listSubArticles(c));
  app.put('/api/sub/articles/:id/read', (c) => navSubController.markSubArticleRead(c));
  app.post('/api/sub/fetch', (c) => navSubController.fetchSub(c));
  app.get('/api/sub/info', (c) => navSubController.subInfo(c));
}
