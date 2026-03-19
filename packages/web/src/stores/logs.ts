import { defineStore } from 'pinia';
import { ref } from 'vue';
import { logsApi, type LogRecord } from '../api';

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<LogRecord[]>([]);
  const loading = ref(false);

  async function loadRecent(limit = 50) {
    loading.value = true;
    try {
      const data = await logsApi.getRecent(limit);
      logs.value = data.logs;
    } finally {
      loading.value = false;
    }
  }

  return {
    logs,
    loading,
    loadRecent
  };
});
