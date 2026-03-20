import type { Context } from 'hono';
import { SettingsHttpError, SettingsService } from '../services/settings-service';
import type { SettingsBackupPayload, SettingsExportStats, SettingsImportSkipped } from '../types/settings';

const MAX_IMPORT_REQUEST_BYTES = 100 * 1024 * 1024;

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
      const body = await readJsonWithLimit<{ backup?: unknown }>(c.req.raw, MAX_IMPORT_REQUEST_BYTES);
      const data = await this.serviceFor(c.env).importBackup(body as { backup?: SettingsBackupPayload });
      await this.appendLog(c.env, 'settings_import', formatImportLog(data.imported, data.skipped));
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

function formatImportLog(imported: SettingsExportStats, skipped: SettingsImportSkipped): string {
  return `导入数据：订阅源 ${imported.sources}，导航分类 ${imported.navigationCategories}，笔记 ${imported.notes}，片段 ${imported.snippets}，剪贴板 ${imported.clipboardItems}，跳过导航链接 ${skipped.navigation.count}`;
}

async function readJsonWithLimit<T>(request: Request, maxBytes: number): Promise<T> {
  try {
    const text = await readTextWithLimit(request, maxBytes);
    if (!text) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SettingsHttpError) {
      throw error;
    }
    return {} as T;
  }
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const bytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new SettingsHttpError(413, `导入请求过大，最大允许 ${maxBytes} 字节`);
    }
  }

  if (!request.body) {
    const text = await request.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) {
      throw new SettingsHttpError(413, `导入请求过大，最大允许 ${maxBytes} 字节`);
    }
    return text;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      throw new SettingsHttpError(413, `导入请求过大，最大允许 ${maxBytes} 字节`);
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function requireParam<TEnv extends object>(c: SettingsContext<TEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new SettingsHttpError(400, `缺少参数: ${name}`);
  }
  return value;
}
