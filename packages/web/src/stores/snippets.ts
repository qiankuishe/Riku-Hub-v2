import { defineStore } from 'pinia';
import { ref } from 'vue';
import { snippetsApi, type SnippetRecord, type SnippetType } from '../api';

export const useSnippetsStore = defineStore('snippets', () => {
  const snippets = ref<SnippetRecord[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  async function loadAll(params?: { type?: SnippetType | 'all'; q?: string }) {
    loading.value = true;
    try {
      const data = await snippetsApi.getAll(params);
      snippets.value = data.snippets;
    } finally {
      loading.value = false;
    }
  }

  async function createSnippet(payload: { type: SnippetType; title?: string; content?: string }) {
    saving.value = true;
    try {
      const data = await snippetsApi.create(payload);
      snippets.value = [data.snippet, ...snippets.value];
      return data.snippet;
    } finally {
      saving.value = false;
    }
  }

  async function updateSnippet(id: string, payload: { type?: SnippetType; title?: string; content?: string; isPinned?: boolean }) {
    saving.value = true;
    try {
      const data = await snippetsApi.update(id, payload);
      snippets.value = snippets.value.map((snippet) => (snippet.id === id ? data.snippet : snippet));
      snippets.value.sort(
        (left, right) => Number(right.isPinned) - Number(left.isPinned) || right.updatedAt.localeCompare(left.updatedAt)
      );
      return data.snippet;
    } finally {
      saving.value = false;
    }
  }

  async function deleteSnippet(id: string) {
    saving.value = true;
    try {
      await snippetsApi.delete(id);
      snippets.value = snippets.value.filter((snippet) => snippet.id !== id);
    } finally {
      saving.value = false;
    }
  }

  return {
    snippets,
    loading,
    saving,
    loadAll,
    createSnippet,
    updateSnippet,
    deleteSnippet
  };
});
