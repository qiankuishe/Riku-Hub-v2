<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ElButton } from 'element-plus';
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
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">运行日志</h2>
          <p class="text-sm text-gray-500">最近系统事件与操作记录。</p>
        </div>
        <ElButton size="small" :loading="loading" @click="loadLogs">
          <Icon icon="carbon:renew" class="mr-1" />
          {{ loading ? '刷新中...' : '刷新' }}
        </ElButton>
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
