import type { Context } from 'hono';
import { CompatNavSubRepository } from '../repositories/compat-nav-sub-repository';
import { CompatNavSubHttpError, CompatNavSubService } from '../services/compat-nav-sub-service';
import type { CompatNavSubBindings } from '../types/compat-nav-sub';

export class CompatNavSubController {
  async nav(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.listNavCategories();
      return c.json({ success: true, data });
    });
  }

  async navCategories(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.nav(c);
  }

  async createNavCategory(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{ name?: string; icon?: string; color?: string }>(c.req.raw);
      const data = await service.createNavCategory(body);
      return c.json({ success: true, data });
    });
  }

  async reorderNavCategories(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{ orders?: Array<{ id?: string; sort_order?: number }>; ids?: string[] }>(c.req.raw);
      await service.reorderNavCategories(body);
      return c.json({ success: true, message: '排序已更新' });
    });
  }

  async updateNavCategory(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{ name?: string; icon?: string; color?: string }>(c.req.raw);
      const data = await service.updateNavCategory(c.req.param('id') ?? '', body);
      return c.json({ success: true, data });
    });
  }

  async deleteNavCategory(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      await service.deleteNavCategory(c.req.param('id') ?? '');
      return c.json({ success: true, message: '分类已删除' });
    });
  }

  async listNavLinks(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.listNavLinks({
        category_id: c.req.query('category_id'),
        categoryId: c.req.query('categoryId'),
        page: c.req.query('page'),
        limit: c.req.query('limit')
      });
      return c.json({ success: true, data });
    });
  }

  async createNavLink(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{
        category_id?: string;
        categoryId?: string;
        title?: string;
        url?: string;
        description?: string;
      }>(c.req.raw);
      const data = await service.createNavLink(body);
      return c.json({ success: true, data });
    });
  }

  async reorderNavLinks(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{ category_id?: string; categoryId?: string; ids?: string[] }>(c.req.raw);
      await service.reorderNavLinks(body);
      return c.json({ success: true, message: '排序已更新' });
    });
  }

  async updateNavLink(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{
        category_id?: string;
        categoryId?: string;
        title?: string;
        url?: string;
        description?: string;
      }>(c.req.raw);
      const data = await service.updateNavLink(c.req.param('id') ?? '', body);
      return c.json({ success: true, data });
    });
  }

  async deleteNavLink(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      await service.deleteNavLink(c.req.param('id') ?? '');
      return c.json({ success: true, message: '链接已删除' });
    });
  }

  async visitNavLink(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.visitNavLink(c.req.param('id') ?? '');
      return c.json({ success: true, data });
    });
  }

  async sub(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.listSubSources();
      return c.json({ success: true, data });
    });
  }

  async subSources(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.sub(c);
  }

  async createSubSource(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{ name?: string; url?: string; content?: string }>(c.req.raw);
      const data = await service.createSubSource(body);
      return c.json({ success: true, data });
    });
  }

  async listSubArticles(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.listSubArticles({
        page: c.req.query('page'),
        limit: c.req.query('limit')
      });
      return c.json({ success: true, data });
    });
  }

  async markSubArticleRead(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.markSubArticleRead();
      return c.json({ success: true, message: data.message });
    });
  }

  async fetchSub(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const body = await readJson<{ source_id?: string; sourceId?: string }>(c.req.raw);
      const data = await service.fetchSub(body);
      return c.json({ success: true, data });
    });
  }

  async subInfo(c: Context<{ Bindings: CompatNavSubBindings }>): Promise<Response> {
    return this.handle(c, async () => {
      const service = this.serviceFor(c.env);
      const data = await service.getSubInfo(c.req.raw);
      return c.json(data);
    });
  }

  private serviceFor(env: CompatNavSubBindings): CompatNavSubService {
    return new CompatNavSubService(new CompatNavSubRepository(env));
  }

  private async handle(c: Context<{ Bindings: CompatNavSubBindings }>, handler: () => Promise<Response>): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof CompatNavSubHttpError) {
        return new Response(JSON.stringify(error.body), {
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
