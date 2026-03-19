export interface NavigationCategoryRecord {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NavigationLinkRecord {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  description: string;
  sortOrder: number;
  visitCount: number;
  lastVisitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NavigationCategoryPayload extends NavigationCategoryRecord {
  links: NavigationLinkRecord[];
}

export interface CreateNavigationCategoryInput {
  name?: string;
}

export interface UpdateNavigationCategoryInput {
  name?: string;
}

export interface ReorderNavigationCategoriesInput {
  ids?: string[];
}

export interface CreateNavigationLinkInput {
  categoryId?: string;
  title?: string;
  url?: string;
  description?: string;
}

export interface UpdateNavigationLinkInput {
  categoryId?: string;
  title?: string;
  url?: string;
  description?: string;
}

export interface ReorderNavigationLinksInput {
  categoryId?: string;
  ids?: string[];
}

export interface NavigationRepositoryDeps<TEnv> {
  getNavigationTree: (env: TEnv) => Promise<NavigationCategoryPayload[]>;
  getNavigationCategory: (env: TEnv, id: string) => Promise<NavigationCategoryRecord | null>;
  getNavigationCategories: (env: TEnv) => Promise<NavigationCategoryRecord[]>;
  createNavigationCategory: (env: TEnv, name: string) => Promise<NavigationCategoryRecord>;
  saveNavigationCategory: (env: TEnv, category: NavigationCategoryRecord) => Promise<NavigationCategoryRecord>;
  reorderNavigationCategories: (env: TEnv, ids: string[]) => Promise<NavigationCategoryRecord[]>;
  deleteNavigationCategory: (env: TEnv, categoryId: string) => Promise<void>;
  getNavigationLink: (env: TEnv, id: string) => Promise<NavigationLinkRecord | null>;
  getNavigationLinksByCategory: (env: TEnv, categoryId: string) => Promise<NavigationLinkRecord[]>;
  createNavigationLink: (
    env: TEnv,
    payload: { categoryId: string; title: string; url: string; description: string }
  ) => Promise<NavigationLinkRecord>;
  reorderNavigationLinks: (env: TEnv, categoryId: string, ids: string[]) => Promise<NavigationLinkRecord[]>;
  updateNavigationLink: (
    env: TEnv,
    link: NavigationLinkRecord,
    changes: { categoryId: string; title: string; url: string; description: string }
  ) => Promise<NavigationLinkRecord>;
  deleteNavigationLink: (env: TEnv, linkId: string, categoryId: string) => Promise<void>;
  recordNavigationLinkVisit: (env: TEnv, link: NavigationLinkRecord) => Promise<NavigationLinkRecord>;
  normalizeNavigationUrl: (value: string | null | undefined) => string;
  isSafeNavigationUrl: (url: string) => boolean;
}

