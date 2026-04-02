<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { logsApi, type LogRecord } from '../../api';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';

const uiStore = useUiStore();
const logs = ref<LogRecord[]>([]);
const loading = ref(false);
const errorMessage = ref('');

onMounted(() => {
  uiStore.clearSecondaryNav();
  void loadLogs();
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
});

async function loadLogs() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await logsApi.getRecent(50);
    logs.value = data.logs;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid gap-4">
    <section class="card">
      <div class="mb-4">
        <div class="logs-title-row">
          <button type="button" class="mobile-menu-btn" @click="uiStore.openMobileNav">
            <Icon icon="carbon:menu" />
          </button>
          <div class="logs-title-content justify-center flex flex-col">
            <h2 class="text-xl font-semibold text-gray-900">运行日志</h2>
          </div>
        </div>
      </div>

      <div v-if="errorMessage" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ errorMessage }}
      </div>
      <div v-else-if="!logs.length" class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        暂无日志
      </div>
      <div v-else class="grid gap-3">
        <article
          v-for="log in logs"
          :key="log.id"
          class="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <div class="mb-1 flex items-center justify-between gap-3">
            <strong class="text-sm text-gray-900">{{ log.action }}</strong>
            <span class="text-xs text-gray-500">{{ formatDateTime(log.createdAt, '尚未刷新') }}</span>
          </div>
          <p class="text-sm text-gray-600">{{ log.detail || '无详情' }}</p>
        </article>
      </div>
    </section>
  </div>
</template>


<style scoped>
.logs-title-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.mobile-menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  cursor: pointer;
  transition: all 150ms ease;
  flex-shrink: 0;
  font-size: 20px;
}

.mobile-menu-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

@media (max-width: 980px) {
  .mobile-menu-btn {
    display: flex;
  }
}
</style>
