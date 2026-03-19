import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { sourcesApi, subApi, type Source, type SubInfo } from '../api';

export const useSubscriptionsStore = defineStore('subscriptions', () => {
  const sources = ref<Source[]>([]);
  const subInfo = ref<SubInfo | null>(null);
  const lastSaveTime = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const refreshing = ref(false);

  const subFormats = computed(() => subInfo.value?.formats ?? []);

  async function loadPageData() {
    loading.value = true;
    try {
      const [sourceData, subData] = await Promise.all([sourcesApi.getAll(), subApi.getInfo()]);
      sources.value = sourceData.sources;
      lastSaveTime.value = sourceData.lastSaveTime;
      subInfo.value = subData;
    } finally {
      loading.value = false;
    }
  }

  async function refreshAggregation() {
    refreshing.value = true;
    try {
      const [sourceData, subData] = await Promise.all([sourcesApi.refresh(), subApi.getInfo()]);
      sources.value = sourceData.sources;
      lastSaveTime.value = sourceData.lastSaveTime;
      subInfo.value = subData;
    } finally {
      refreshing.value = false;
    }
  }

  async function createSource(name: string, content: string) {
    saving.value = true;
    try {
      const data = await sourcesApi.create(name, content);
      sources.value.push(data.source);
      lastSaveTime.value = data.lastSaveTime;
    } finally {
      saving.value = false;
    }
  }

  async function updateSource(id: string, payload: { name?: string; content?: string }) {
    saving.value = true;
    try {
      const data = await sourcesApi.update(id, payload);
      const index = sources.value.findIndex((source) => source.id === id);
      if (index >= 0) {
        sources.value[index] = data.source;
      }
      lastSaveTime.value = data.lastSaveTime;
    } finally {
      saving.value = false;
    }
  }

  async function deleteSource(id: string) {
    saving.value = true;
    try {
      const data = await sourcesApi.delete(id);
      sources.value = sources.value.filter((source) => source.id !== id);
      lastSaveTime.value = data.lastSaveTime;
    } finally {
      saving.value = false;
    }
  }

  async function reorderSources(ids: string[]) {
    saving.value = true;
    try {
      const data = await sourcesApi.reorder(ids);
      lastSaveTime.value = data.lastSaveTime;
      sources.value = [...sources.value].sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
    } finally {
      saving.value = false;
    }
  }

  return {
    sources,
    subInfo,
    subFormats,
    lastSaveTime,
    loading,
    saving,
    refreshing,
    loadPageData,
    refreshAggregation,
    createSource,
    updateSource,
    deleteSource,
    reorderSources
  };
});
