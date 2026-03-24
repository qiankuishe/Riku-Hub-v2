import type { Hono } from 'hono';
import { SettingsController } from '../controllers/settings-controller';
import { SettingsRepository } from '../repositories/settings-repository';
import { SettingsService } from '../services/settings-service';
import type { SettingsRepositoryDeps } from '../types/settings';

interface SettingsRouteOptions<TEnv extends object> {
  deps: SettingsRepositoryDeps<TEnv>;
  appendLog: (env: TEnv, action: string, detail?: string) => Promise<void>;
}

export function mountSettingsRoutes<TEnv extends object>(
  app: Hono<any>,
  options: SettingsRouteOptions<TEnv>
): void {
  const controller = new SettingsController<TEnv>(
    (env) => new SettingsService(new SettingsRepository(env, options.deps)),
    options.appendLog
  );

  app.get('/api/logs', (c) => controller.listLogs(c));
  app.get('/api/settings/export/stats', (c) => controller.exportStats(c));
  app.get('/api/settings/export', (c) => controller.exportBackup(c));
  app.post('/api/settings/import', (c) => controller.importBackup(c));
  app.delete('/api/settings/data/:scope', (c) => controller.clearData(c));
  
  // Settings CRUD routes
  app.get('/api/settings', (c) => controller.getSettings(c));
  app.get('/api/settings/:key', (c) => controller.getSetting(c));
  app.put('/api/settings/:key', (c) => controller.setSetting(c));
  app.delete('/api/settings/:key', (c) => controller.deleteSetting(c));
}

