import type { Context } from 'hono';
import { SettingsHttpError, SettingsService } from '../services/settings-service';
import type { SettingsBackupPayload, SettingsExportStats } from '../types/settings';

type SettingsContext<TEnv extends object> = Context<{ Bindings: TEnv }>;
type ServiceFactory<TEnv extends object> = (env: TEnv) => SettingsService<TEnv>;
type AppendLog<TEnv extends object> = (env: TEnv, action: string, detail?: string) => Promise<void>;

export class SettingsController<TEnv extends object> {
  constructor(
    private readonly serviceFor: ServiceFactory<TEnv>,
    private readonly appendLog: AppendLog<TEnv>
  ) {}

  async listLogs(c: SettingsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).listLogs(c.req.query('limit'));
      return c.json(data);
    });
  }

  async exportStats(c: SettingsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).getExportStats();
      return c.json(data);
    });
  }

  async exportBackup(c: SettingsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).exportBackup();
      return c.json(data);
    });
  }

  async importBackup(c: SettingsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<{ backup?: unknown }>(c.req.raw);
      const data = await this.serviceFor(c.env).importBackup(body as { backup?: SettingsBackupPayload });
      await this.appendLog(c.env, 'settings_import', formatImportLog(data.imported));
      return c.json(data);
    });
  }

  async clearData(c: SettingsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const scopeValue = requireParam(c, 'scope');
      const data = await this.serviceFor(c.env).clearData(scopeValue);
      await this.appendLog(c.env, 'settings_clear', `清理数据范围：${data.scope}`);
      return c.json(data);
    });
  }

  private async handle(c: SettingsContext<TEnv>, task: () => Promise<Response>): Promise<Response> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof SettingsHttpError) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: error.status,
          headers: {
            'content-type': 'application/json; charset=UTF-8'
          }
        });
      }
      throw error;
    }
  }
}

function formatImportLog(imported: SettingsExportStats): string {
  return `导入数据：订阅源 ${imported.sources}，导航分类 ${imported.navigationCategories}，笔记 ${imported.notes}，片段 ${imported.snippets}`;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function requireParam<TEnv extends object>(c: SettingsContext<TEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new SettingsHttpError(400, `缺少参数: ${name}`);
  }
  return value;
}
