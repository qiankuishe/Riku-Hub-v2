import { NavigationRepository } from '../repositories/navigation-repository';
import type {
  CreateNavigationCategoryInput,
  CreateNavigationLinkInput,
  ReorderNavigationCategoriesInput,
  ReorderNavigationLinksInput,
  UpdateNavigationCategoryInput,
  UpdateNavigationLinkInput
} from '../types/navigation';

export class NavigationHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class NavigationService<TEnv> {
  constructor(private readonly repository: NavigationRepository<TEnv>) {}

  async getOverview(): Promise<{ categories: Awaited<ReturnType<NavigationRepository<TEnv>['getTree']>>; totalCategories: number; totalLinks: number }> {
    const categories = await this.repository.getTree();
    return {
      categories,
      totalCategories: categories.length,
      totalLinks: categories.reduce((sum, category) => sum + category.links.length, 0)
    };
  }

  async createCategory(input: CreateNavigationCategoryInput): Promise<Awaited<ReturnType<NavigationRepository<TEnv>['createCategory']>>> {
    const name = input.name?.trim();
    if (!name) {
      throw new NavigationHttpError(400, '分类名称不能为空');
    }
    return this.repository.createCategory(name);
  }

  async reorderCategories(input: ReorderNavigationCategoriesInput): Promise<Awaited<ReturnType<NavigationRepository<TEnv>['reorderCategories']>>> {
    const ids = input.ids ?? [];
    const categories = await this.repository.getCategories();
    const idSet = new Set(categories.map((category) => category.id));
    if (ids.length !== categories.length || ids.some((id) => !idSet.has(id))) {
      throw new NavigationHttpError(400, '分类排序数据无效');
    }
    return this.repository.reorderCategories(ids);
  }

  async updateCategory(id: string, input: UpdateNavigationCategoryInput): Promise<Awaited<ReturnType<NavigationRepository<TEnv>['saveCategory']>>> {
    const category = await this.repository.getCategory(id);
    if (!category) {
      throw new NavigationHttpError(404, '分类不存在');
    }
    const name = input.name?.trim();
    if (!name) {
      throw new NavigationHttpError(400, '分类名称不能为空');
    }
    return this.repository.saveCategory({
      ...category,
      name,
      updatedAt: new Date().toISOString()
    });
  }

  async deleteCategory(id: string): Promise<{ name: string }> {
    const category = await this.repository.getCategory(id);
    if (!category) {
      throw new NavigationHttpError(404, '分类不存在');
    }
    await this.repository.deleteCategory(category.id);
    return { name: category.name };
  }

  async createLink(input: CreateNavigationLinkInput): Promise<Awaited<ReturnType<NavigationRepository<TEnv>['createLink']>>> {
    const title = input.title?.trim();
    const url = this.repository.normalizeUrl(input.url);
    const categoryId = input.categoryId?.trim();
    if (!categoryId || !title || !url) {
      throw new NavigationHttpError(400, '分类、标题和链接不能为空');
    }
    if (!this.repository.isSafeUrl(url)) {
      throw new NavigationHttpError(400, '站点链接必须是 http 或 https 地址');
    }
    const category = await this.repository.getCategory(categoryId);
    if (!category) {
      throw new NavigationHttpError(404, '分类不存在');
    }
    return this.repository.createLink({
      categoryId,
      title,
      url,
      description: input.description?.trim() ?? ''
    });
  }

  async visitLink(id: string): Promise<{ visitCount: number; lastVisitedAt: string | null }> {
    const link = await this.repository.getLink(id);
    if (!link) {
      throw new NavigationHttpError(404, '站点不存在');
    }
    const updated = await this.repository.recordLinkVisit(link);
    return {
      visitCount: updated.visitCount,
      lastVisitedAt: updated.lastVisitedAt
    };
  }

  async reorderLinks(input: ReorderNavigationLinksInput): Promise<Awaited<ReturnType<NavigationRepository<TEnv>['reorderLinks']>>> {
    const categoryId = input.categoryId?.trim();
    const ids = input.ids ?? [];
    if (!categoryId) {
      throw new NavigationHttpError(400, '缺少分类标识');
    }
    const category = await this.repository.getCategory(categoryId);
    if (!category) {
      throw new NavigationHttpError(404, '分类不存在');
    }
    const links = await this.repository.getLinksByCategory(categoryId);
    const idSet = new Set(links.map((link) => link.id));
    if (ids.length !== links.length || ids.some((id) => !idSet.has(id))) {
      throw new NavigationHttpError(400, '站点排序数据无效');
    }
    return this.repository.reorderLinks(categoryId, ids);
  }

  async updateLink(id: string, input: UpdateNavigationLinkInput): Promise<Awaited<ReturnType<NavigationRepository<TEnv>['updateLink']>>> {
    const link = await this.repository.getLink(id);
    if (!link) {
      throw new NavigationHttpError(404, '站点不存在');
    }

    const nextCategoryId = input.categoryId?.trim() ?? link.categoryId;
    const category = await this.repository.getCategory(nextCategoryId);
    if (!category) {
      throw new NavigationHttpError(404, '目标分类不存在');
    }

    const nextUrl = typeof input.url === 'string' ? this.repository.normalizeUrl(input.url) : link.url;
    if (!this.repository.isSafeUrl(nextUrl)) {
      throw new NavigationHttpError(400, '站点链接必须是 http 或 https 地址');
    }

    return this.repository.updateLink(link, {
      categoryId: nextCategoryId,
      title: input.title?.trim() ?? link.title,
      url: nextUrl,
      description: input.description?.trim() ?? link.description
    });
  }

  async deleteLink(id: string): Promise<{ title: string }> {
    const link = await this.repository.getLink(id);
    if (!link) {
      throw new NavigationHttpError(404, '站点不存在');
    }
    await this.repository.deleteLink(link.id, link.categoryId);
    return { title: link.title };
  }
}

