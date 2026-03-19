import type { Context } from 'hono';
import { SubscriptionsHttpError, SubscriptionsService } from '../services/subscriptions-service';
import type { SourceCreateInput, SourceReorderInput, SourceUpdateInput, SourceValidateInput } from '../types/subscriptions';

type SubscriptionsContext<TEnv extends object> = Context<{ Bindings: TEnv }>;
type ServiceFactory<TEnv extends object> = (env: TEnv) => SubscriptionsService<TEnv>;
type AppendLog<TEnv extends object> = (env: TEnv, action: string, detail?: string) => Promise<void>;

export class SubscriptionsController<TEnv extends object> {
  constructor(
    private readonly serviceFor: ServiceFactory<TEnv>,
    private readonly appendLog: AppendLog<TEnv>
  ) {}

  async listSources(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).listSources();
      return c.json(data);
    });
  }

  async getSource(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const source = await this.serviceFor(c.env).getSource(requireParam(c, 'id'));
      return c.json(source);
    });
  }

  async validateSource(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<SourceValidateInput>(c.req.raw);
      const result = await this.serviceFor(c.env).validateSource(body);
      return c.json(result);
    });
  }

  async sourceWarnings(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).getSourceWarnings(requireParam(c, 'id'));
      return c.json(data);
    });
  }

  async createSource(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<SourceCreateInput>(c.req.raw);
      const data = await this.serviceFor(c.env).createSource(body);
      await this.appendLog(c.env, 'source_create', `创建订阅源: ${data.source.name}`);
      return c.json(data);
    });
  }

  async reorderSources(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<SourceReorderInput>(c.req.raw);
      const data = await this.serviceFor(c.env).reorderSources(body);
      await this.appendLog(c.env, 'source_reorder', '更新订阅源排序');
      return c.json(data);
    });
  }

  async updateSource(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<SourceUpdateInput>(c.req.raw);
      const data = await this.serviceFor(c.env).updateSource(requireParam(c, 'id'), body);
      await this.appendLog(c.env, 'source_update', `更新订阅源: ${data.source.name}`);
      return c.json(data);
    });
  }

  async deleteSource(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).deleteSource(requireParam(c, 'id'));
      await this.appendLog(c.env, 'source_delete', `删除订阅源: ${data.name}`);
      return c.json({ success: true, lastSaveTime: data.lastSaveTime });
    });
  }

  async refreshSources(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).refreshSources();
      await this.appendLog(c.env, 'source_refresh', `手动刷新订阅缓存，共 ${data.nodeCount} 条节点`);
      return c.json({
        sources: data.sources,
        lastSaveTime: data.lastSaveTime,
        warningCount: data.warningCount,
        warnings: data.warnings
      });
    });
  }

  async subscription(c: SubscriptionsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).buildSubscriptionPayload(c.req.url, c.req.header('user-agent') || '');
      await this.appendLog(
        c.env,
        'subscription',
        `订阅请求: format=${data.format}, nodes=${data.totalNodes}, stale=${String(data.fromStaleCache)}`
      );
      c.header('Content-Type', data.contentType);
      c.header('Content-Disposition', `attachment; filename="${data.fileName}"`);
      c.header('X-Riku-Hub-Cache-Status', data.cacheStatus);
      c.header('X-Riku-Hub-Warning-Count', String(data.warningCount));
      return c.body(data.content);
    });
  }

  private async handle(c: SubscriptionsContext<TEnv>, task: () => Promise<Response>): Promise<Response> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof SubscriptionsHttpError) {
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

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function requireParam<TEnv extends object>(c: SubscriptionsContext<TEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new SubscriptionsHttpError(400, `缺少参数: ${name}`);
  }
  return value;
}
