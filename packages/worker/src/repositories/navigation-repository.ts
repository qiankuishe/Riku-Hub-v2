import type {
  NavigationCategoryPayload,
  NavigationCategoryRecord,
  NavigationLinkRecord,
  NavigationRepositoryDeps
} from '../types/navigation';

export class NavigationRepository<TEnv> {
  constructor(
    private readonly env: TEnv,
    private readonly deps: NavigationRepositoryDeps<TEnv>
  ) {}

  getTree(): Promise<NavigationCategoryPayload[]> {
    return this.deps.getNavigationTree(this.env);
  }

  getCategory(id: string): Promise<NavigationCategoryRecord | null> {
    return this.deps.getNavigationCategory(this.env, id);
  }

  getCategories(): Promise<NavigationCategoryRecord[]> {
    return this.deps.getNavigationCategories(this.env);
  }

  createCategory(name: string): Promise<NavigationCategoryRecord> {
    return this.deps.createNavigationCategory(this.env, name);
  }

  saveCategory(category: NavigationCategoryRecord): Promise<NavigationCategoryRecord> {
    return this.deps.saveNavigationCategory(this.env, category);
  }

  reorderCategories(ids: string[]): Promise<NavigationCategoryRecord[]> {
    return this.deps.reorderNavigationCategories(this.env, ids);
  }

  deleteCategory(categoryId: string): Promise<void> {
    return this.deps.deleteNavigationCategory(this.env, categoryId);
  }

  getLink(id: string): Promise<NavigationLinkRecord | null> {
    return this.deps.getNavigationLink(this.env, id);
  }

  getLinksByCategory(categoryId: string): Promise<NavigationLinkRecord[]> {
    return this.deps.getNavigationLinksByCategory(this.env, categoryId);
  }

  createLink(payload: { categoryId: string; title: string; url: string; description: string }): Promise<NavigationLinkRecord> {
    return this.deps.createNavigationLink(this.env, payload);
  }

  reorderLinks(categoryId: string, ids: string[]): Promise<NavigationLinkRecord[]> {
    return this.deps.reorderNavigationLinks(this.env, categoryId, ids);
  }

  updateLink(
    link: NavigationLinkRecord,
    changes: { categoryId: string; title: string; url: string; description: string }
  ): Promise<NavigationLinkRecord> {
    return this.deps.updateNavigationLink(this.env, link, changes);
  }

  deleteLink(linkId: string, categoryId: string): Promise<void> {
    return this.deps.deleteNavigationLink(this.env, linkId, categoryId);
  }

  recordLinkVisit(link: NavigationLinkRecord): Promise<NavigationLinkRecord> {
    return this.deps.recordNavigationLinkVisit(this.env, link);
  }

  normalizeUrl(value: string | null | undefined): string {
    return this.deps.normalizeNavigationUrl(value);
  }

  isSafeUrl(url: string): boolean {
    return this.deps.isSafeNavigationUrl(url);
  }
}

