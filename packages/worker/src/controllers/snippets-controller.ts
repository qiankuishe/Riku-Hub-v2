import type { Context } from 'hono';
import { SnippetsHttpError, SnippetsService } from '../services/snippets-service';
import type { SnippetCreateInput, SnippetUpdateInput } from '../types/snippets';

type SnippetsContext<TEnv extends object> = Context<{ Bindings: TEnv }>;
type ServiceFactory<TEnv extends object> = (env: TEnv) => SnippetsService<TEnv>;

export class SnippetsController<TEnv extends object> {
  constructor(private readonly serviceFor: ServiceFactory<TEnv>) {}

  async listSnippets(c: SnippetsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).listSnippets({
        type: c.req.query('type'),
        query: c.req.query('q')
      });
      return c.json(data);
    });
  }

  async createSnippet(c: SnippetsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<SnippetCreateInput>(c.req.raw);
      const data = await this.serviceFor(c.env).createSnippet(body);
      return c.json(data);
    });
  }

  async updateSnippet(c: SnippetsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<SnippetUpdateInput>(c.req.raw);
      const data = await this.serviceFor(c.env).updateSnippet(requireParam(c, 'id'), body);
      return c.json(data);
    });
  }

  async deleteSnippet(c: SnippetsContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).deleteSnippet(requireParam(c, 'id'));
      return c.json(data);
    });
  }

  private async handle(c: SnippetsContext<TEnv>, task: () => Promise<Response>): Promise<Response> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof SnippetsHttpError) {
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

function requireParam<TEnv extends object>(c: SnippetsContext<TEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new SnippetsHttpError(400, `缺少参数: ${name}`);
  }
  return value;
}

