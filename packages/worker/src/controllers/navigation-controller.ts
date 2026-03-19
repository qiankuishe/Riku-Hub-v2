import type { Context } from 'hono';
import { NavigationHttpError, NavigationService } from '../services/navigation-service';
import type {
  CreateNavigationCategoryInput,
  CreateNavigationLinkInput,
  ReorderNavigationCategoriesInput,
  ReorderNavigationLinksInput,
  UpdateNavigationCategoryInput,
  UpdateNavigationLinkInput
} from '../types/navigation';

type NavigationContext<TEnv extends object> = Context<{ Bindings: TEnv }>;
type ServiceFactory<TEnv extends object> = (env: TEnv) => NavigationService<TEnv>;
type AppendLog<TEnv extends object> = (env: TEnv, action: string, detail?: string) => Promise<void>;

export class NavigationController<TEnv extends object> {
  constructor(
    private readonly serviceFor: ServiceFactory<TEnv>,
    private readonly appendLog: AppendLog<TEnv>
  ) {}

  async overview(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).getOverview();
      return c.json(data);
    });
  }

  async createCategory(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<CreateNavigationCategoryInput>(c.req.raw);
      const category = await this.serviceFor(c.env).createCategory(body);
      await this.appendLog(c.env, 'nav_category_create', `创建导航分类: ${category.name}`);
      return c.json({ category });
    });
  }

  async reorderCategories(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<ReorderNavigationCategoriesInput>(c.req.raw);
      const categories = await this.serviceFor(c.env).reorderCategories(body);
      return c.json({ categories });
    });
  }

  async updateCategory(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<UpdateNavigationCategoryInput>(c.req.raw);
      const category = await this.serviceFor(c.env).updateCategory(requireParam(c, 'id'), body);
      return c.json({ category });
    });
  }

  async deleteCategory(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const result = await this.serviceFor(c.env).deleteCategory(requireParam(c, 'id'));
      await this.appendLog(c.env, 'nav_category_delete', `删除导航分类: ${result.name}`);
      return c.json({ success: true });
    });
  }

  async createLink(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<CreateNavigationLinkInput>(c.req.raw);
      const link = await this.serviceFor(c.env).createLink(body);
      await this.appendLog(c.env, 'nav_link_create', `创建导航站点: ${link.title}`);
      return c.json({ link });
    });
  }

  async visitLink(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const data = await this.serviceFor(c.env).visitLink(requireParam(c, 'id'));
      return c.json(data);
    });
  }

  async reorderLinks(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<ReorderNavigationLinksInput>(c.req.raw);
      const links = await this.serviceFor(c.env).reorderLinks(body);
      return c.json({ links });
    });
  }

  async updateLink(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const body = await readJson<UpdateNavigationLinkInput>(c.req.raw);
      const link = await this.serviceFor(c.env).updateLink(requireParam(c, 'id'), body);
      return c.json({ link });
    });
  }

  async deleteLink(c: NavigationContext<TEnv>): Promise<Response> {
    return this.handle(c, async () => {
      const result = await this.serviceFor(c.env).deleteLink(requireParam(c, 'id'));
      await this.appendLog(c.env, 'nav_link_delete', `删除导航站点: ${result.title}`);
      return c.json({ success: true });
    });
  }

  private async handle(c: NavigationContext<TEnv>, task: () => Promise<Response>): Promise<Response> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof NavigationHttpError) {
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

function requireParam<TEnv extends object>(c: NavigationContext<TEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new NavigationHttpError(400, `缺少参数: ${name}`);
  }
  return value;
}
