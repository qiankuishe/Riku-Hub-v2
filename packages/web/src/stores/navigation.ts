import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { navigationApi, type NavigationCategory, type NavigationLink } from '../api';

export const useNavigationStore = defineStore('navigation', () => {
  const categories = ref<NavigationCategory[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  const totalLinks = computed(() => categories.value.reduce((sum, category) => sum + category.links.length, 0));
  const recentLinks = computed(() =>
    categories.value
      .flatMap((category) => category.links.map((link) => ({ ...link, categoryName: category.name })))
      .filter((link) => Boolean(link.lastVisitedAt))
      .sort((left, right) => (right.lastVisitedAt ?? '').localeCompare(left.lastVisitedAt ?? ''))
  );

  async function loadAll() {
    loading.value = true;
    try {
      const data = await navigationApi.getAll();
      categories.value = data.categories;
    } finally {
      loading.value = false;
    }
  }

  async function createCategory(name: string) {
    saving.value = true;
    try {
      const data = await navigationApi.createCategory(name);
      categories.value.push({ ...data.category, links: [] });
      categories.value.sort((left, right) => left.sortOrder - right.sortOrder);
      return data.category;
    } finally {
      saving.value = false;
    }
  }

  async function updateCategory(id: string, name: string) {
    saving.value = true;
    try {
      const data = await navigationApi.updateCategory(id, { name });
      categories.value = categories.value.map((category) =>
        category.id === id ? { ...category, ...data.category, links: category.links } : category
      );
      return data.category;
    } finally {
      saving.value = false;
    }
  }

  async function deleteCategory(id: string) {
    saving.value = true;
    try {
      await navigationApi.deleteCategory(id);
      categories.value = categories.value.filter((category) => category.id !== id);
    } finally {
      saving.value = false;
    }
  }

  async function reorderCategories(ids: string[]) {
    saving.value = true;
    try {
      const data = await navigationApi.reorderCategories(ids);
      categories.value = data.categories.map((category) => {
        const existing = categories.value.find((item) => item.id === category.id);
        return {
          ...category,
          links: existing?.links ?? []
        };
      });
    } finally {
      saving.value = false;
    }
  }

  async function createLink(payload: { categoryId: string; title: string; url: string; description?: string }) {
    saving.value = true;
    try {
      const data = await navigationApi.createLink(payload);
      categories.value = categories.value.map((category) =>
        category.id === payload.categoryId
          ? { ...category, links: [...category.links, data.link].sort((left, right) => left.sortOrder - right.sortOrder) }
          : category
      );
      return data.link;
    } finally {
      saving.value = false;
    }
  }

  async function updateLink(id: string, payload: { categoryId?: string; title?: string; url?: string; description?: string }) {
    saving.value = true;
    try {
      const existing = categories.value.flatMap((category) => category.links).find((link) => link.id === id);
      const previousCategoryId = existing?.categoryId;
      const data = await navigationApi.updateLink(id, payload);
      const nextCategoryId = data.link.categoryId;

      categories.value = categories.value.map((category) => {
        let links = category.links.filter((link) => link.id !== id);
        if (category.id === nextCategoryId) {
          links = [...links, data.link].sort((left, right) => left.sortOrder - right.sortOrder);
        }
        return { ...category, links };
      });

      if (previousCategoryId && previousCategoryId !== nextCategoryId) {
        categories.value = categories.value.map((category) => ({
          ...category,
          links: category.links.sort((left, right) => left.sortOrder - right.sortOrder)
        }));
      }

      return data.link;
    } finally {
      saving.value = false;
    }
  }

  async function deleteLink(id: string) {
    saving.value = true;
    try {
      await navigationApi.deleteLink(id);
      categories.value = categories.value.map((category) => ({
        ...category,
        links: category.links.filter((link) => link.id !== id)
      }));
    } finally {
      saving.value = false;
    }
  }

  async function reorderLinks(categoryId: string, ids: string[]) {
    saving.value = true;
    try {
      const data = await navigationApi.reorderLinks(categoryId, ids);
      categories.value = categories.value.map((category) =>
        category.id === categoryId ? { ...category, links: data.links } : category
      );
    } finally {
      saving.value = false;
    }
  }

  async function recordVisit(linkId: string) {
    const data = await navigationApi.recordVisit(linkId);
    categories.value = categories.value.map((category) => ({
      ...category,
      links: category.links.map((link) =>
        link.id === linkId
          ? {
              ...link,
              visitCount: data.visitCount,
              lastVisitedAt: data.lastVisitedAt
            }
          : link
      )
    }));
    return data;
  }

  function getCategory(categoryId: string | null) {
    if (!categoryId) {
      return null;
    }
    return categories.value.find((category) => category.id === categoryId) ?? null;
  }

  function getLink(linkId: string | null): NavigationLink | null {
    if (!linkId) {
      return null;
    }
    return categories.value.flatMap((category) => category.links).find((link) => link.id === linkId) ?? null;
  }

  return {
    categories,
    totalLinks,
    recentLinks,
    loading,
    saving,
    loadAll,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    createLink,
    updateLink,
    deleteLink,
    reorderLinks,
    recordVisit,
    getCategory,
    getLink
  };
});
