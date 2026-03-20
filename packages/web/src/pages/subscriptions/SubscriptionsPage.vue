<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElAlert, ElButton, ElDialog, ElInput, ElTag } from 'element-plus';
import { Icon } from '@iconify/vue';
import type { Source, SubInfo, ValidationResult } from '../../api';
import { sourcesApi, subApi } from '../../api';
import { formatDateTime } from '../../utils/date';
import { useUiStore } from '../../stores/ui';

const uiStore = useUiStore();

const sources = ref<Source[]>([]);
const subInfo = ref<SubInfo | null>(null);
const lastSaveTime = ref('');
const loading = ref(false);
const saving = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const editorOpen = ref(false);
const editingSource = ref<Source | null>(null);
const formName = ref('');
const formContent = ref('');
const validation = ref<ValidationResult | null>(null);
const validating = ref(false);
const qrDialogVisible = ref(false);
const qrTitle = ref('');
const qrDataUrl = ref('');
const deleteTarget = ref<Source | null>(null);

let validateTimer = 0;
let validateRunId = 0;

const cacheStatusMeta = computed(() => {
  const status = subInfo.value?.cacheStatus ?? 'missing';
  if (status === 'fresh') {
    return { label: '缓存有效', type: 'success' as const };
  }
  if (status === 'stale') {
    return { label: '缓存较旧', type: 'warning' as const };
  }
  return { label: '未生成缓存', type: 'info' as const };
});

watch(formContent, () => {
  if (!editorOpen.value) {
    return;
  }
  clearValidateTimer();
  validateTimer = window.setTimeout(() => {
    void runValidate();
  }, 300);
});

watch(editorOpen, (open) => {
  if (open) {
    return;
  }
  validateRunId += 1;
  clearValidateTimer();
  validating.value = false;
});

onMounted(() => {
  void loadPageData();
});

onUnmounted(() => {
  validateRunId += 1;
  clearValidateTimer();
});

async function loadPageData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [sourceData, subData] = await Promise.all([sourcesApi.getAll(), subApi.getInfo()]);
    sources.value = sourceData.sources;
    lastSaveTime.value = sourceData.lastSaveTime;
    subInfo.value = subData;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败';
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
    uiStore.showToast('聚合缓存已刷新');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '刷新失败');
  } finally {
    refreshing.value = false;
  }
}

function openCreateDialog() {
  editingSource.value = null;
  formName.value = '';
  formContent.value = '';
  validation.value = null;
  errorMessage.value = '';
  editorOpen.value = true;
}

function openEditDialog(source: Source) {
  editingSource.value = source;
  formName.value = source.name;
  formContent.value = source.content;
  validation.value = null;
  errorMessage.value = '';
  editorOpen.value = true;
}

function closeEditor() {
  editorOpen.value = false;
  validateRunId += 1;
  clearValidateTimer();
  errorMessage.value = '';
  validation.value = null;
  validating.value = false;
}

function closeDeleteDialog() {
  deleteTarget.value = null;
}

async function runValidate() {
  const content = formContent.value.trim();
  if (!content) {
    validation.value = null;
    return;
  }

  const runId = ++validateRunId;
  validating.value = true;
  try {
    const result = await sourcesApi.validate(content);
    if (runId !== validateRunId) {
      return;
    }
    validation.value = result;
  } catch (error) {
    if (runId !== validateRunId) {
      return;
    }
    validation.value = null;
    errorMessage.value = error instanceof Error ? error.message : '校验失败';
  } finally {
    if (runId === validateRunId) {
      validating.value = false;
    }
  }
}

function clearValidateTimer() {
  if (!validateTimer) {
    return;
  }
  window.clearTimeout(validateTimer);
  validateTimer = 0;
}

async function saveSource() {
  if (!formName.value.trim() || !formContent.value.trim()) {
    errorMessage.value = '名称和内容不能为空';
    return;
  }

  saving.value = true;
  errorMessage.value = '';
  try {
    if (editingSource.value) {
      const result = await sourcesApi.update(editingSource.value.id, {
        name: formName.value.trim(),
        content: formContent.value.trim(),
        enabled: editingSource.value.enabled
      });
      lastSaveTime.value = result.lastSaveTime;
      uiStore.showToast('订阅源已更新');
    } else {
      const result = await sourcesApi.create(formName.value.trim(), formContent.value.trim());
      lastSaveTime.value = result.lastSaveTime;
      uiStore.showToast('订阅源已创建');
    }
    closeEditor();
    await loadPageData();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

async function toggleSourceEnabled(source: Source) {
  try {
    const result = await sourcesApi.update(source.id, {
      enabled: !source.enabled
    });
    lastSaveTime.value = result.lastSaveTime;
    uiStore.showToast(!source.enabled ? '已启用' : '已禁用');
    // 重新加载数据以更新状态
    await loadPageData();
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '操作失败');
  }
}

async function moveSource(source: Source, direction: -1 | 1) {
  const list = [...sources.value];
  const index = list.findIndex((entry) => entry.id === source.id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= list.length) {
    return;
  }
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item);

  try {
    const result = await sourcesApi.reorder(list.map((entry) => entry.id));
    lastSaveTime.value = result.lastSaveTime;
    sources.value = list;
    uiStore.showToast(direction < 0 ? '已上移' : '已下移');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '排序失败');
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) {
    return;
  }
  saving.value = true;
  try {
    const result = await sourcesApi.delete(deleteTarget.value.id);
    lastSaveTime.value = result.lastSaveTime;
    deleteTarget.value = null;
    await loadPageData();
    uiStore.showToast('订阅源已删除');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除失败');
  } finally {
    saving.value = false;
  }
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    uiStore.showToast('已复制');
  } catch {
    uiStore.showToast('复制失败');
  }
}

async function openQr(name: string, url: string) {
  const { toDataURL } = await import('qrcode');
  qrTitle.value = name;
  qrDataUrl.value = await toDataURL(url, { width: 280, margin: 1 });
  qrDialogVisible.value = true;
}

function formatValidationWarning(warning: { message: string; context?: string | null }) {
  if (!warning.context) {
    return warning.message;
  }
  return `${warning.message}（目标: ${warning.context}）`;
}
</script>

<template>
  <div class="grid gap-4">
    <section class="card">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">订阅聚合</h2>
          <p class="text-sm text-gray-500">统一管理订阅源并输出多格式链接。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <ElButton type="primary" @click="openCreateDialog">
            <Icon icon="carbon:add-alt" class="mr-1" />
            新增订阅源
          </ElButton>
          <ElButton :loading="refreshing" @click="refreshAggregation">
            <Icon icon="carbon:renew" class="mr-1" />
            {{ refreshing ? '刷新中...' : '刷新缓存' }}
          </ElButton>
        </div>
      </div>

      <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div class="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs text-gray-500">总节点</p>
          <p class="mt-1 text-xl font-semibold text-gray-900">{{ subInfo?.totalNodes ?? 0 }}</p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs text-gray-500">缓存状态</p>
          <div class="mt-1">
            <ElTag size="small" :type="cacheStatusMeta.type">{{ cacheStatusMeta.label }}</ElTag>
          </div>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p class="text-xs text-gray-500">最近保存</p>
          <p class="mt-1 text-sm text-gray-700">{{ lastSaveTime ? formatDateTime(lastSaveTime) : '-' }}</p>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <article
          v-for="format in subInfo?.formats ?? []"
          :key="format.key"
          class="rounded-xl border border-gray-200 bg-white px-4 py-3"
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <strong class="text-sm text-gray-900">{{ format.name }}</strong>
            <div class="flex gap-2">
              <ElButton size="small" @click="copyLink(format.url)">复制</ElButton>
              <ElButton size="small" @click="openQr(format.name, format.url)">二维码</ElButton>
            </div>
          </div>
          <p class="break-all text-xs leading-5 text-gray-500">{{ format.url }}</p>
        </article>
      </div>
    </section>

    <section class="card">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h3 class="text-lg font-semibold text-gray-900">订阅源列表</h3>
        <span class="text-sm text-gray-500">{{ sources.length }} 条</span>
      </div>

      <ElAlert v-if="errorMessage && !editorOpen" :closable="false" show-icon type="error" :title="errorMessage" class="mb-3" />
      <div
        v-else-if="loading"
        class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500"
      >
        加载中...
      </div>
      <div
        v-else-if="!sources.length"
        class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500"
      >
        暂无订阅源
      </div>
      <div v-else class="grid gap-3">
        <article
          v-for="source in sources"
          :key="source.id"
          class="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          :class="{ 'opacity-50': !source.enabled }"
        >
          <div class="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h4 class="truncate text-sm font-semibold text-gray-900">{{ source.name }}</h4>
                <ElTag v-if="!source.enabled" size="small" type="info">已禁用</ElTag>
              </div>
              <p class="mt-1 text-xs text-gray-500">
                节点数 {{ source.nodeCount }} · 更新于 {{ formatDateTime(source.updatedAt) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <ElButton size="small" @click="toggleSourceEnabled(source)">
                {{ source.enabled ? '禁用' : '启用' }}
              </ElButton>
              <ElButton size="small" @click="moveSource(source, -1)">上移</ElButton>
              <ElButton size="small" @click="moveSource(source, 1)">下移</ElButton>
              <ElButton size="small" @click="openEditDialog(source)">编辑</ElButton>
              <ElButton size="small" type="danger" @click="deleteTarget = source">删除</ElButton>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>

  <ElDialog
    v-model="editorOpen"
    :title="editingSource ? '编辑订阅源' : '新增订阅源'"
    width="760px"
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    align-center
    @close="closeEditor"
  >
    <div class="grid gap-4">
      <div class="grid gap-2">
        <label class="text-sm font-medium text-gray-700">名称</label>
        <ElInput v-model="formName" placeholder="订阅源名称" />
      </div>

      <div class="grid gap-2">
        <label class="text-sm font-medium text-gray-700">内容</label>
        <ElInput v-model="formContent" type="textarea" :rows="12" placeholder="订阅内容..." />
        <p v-if="validating" class="text-xs text-gray-500">校验中...</p>
      </div>

      <div v-if="validation" class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <p class="text-sm text-gray-700">
          URL {{ validation.urlCount }} / 节点 {{ validation.nodeCount }} / 总数 {{ validation.totalCount }} /
          重复 {{ validation.duplicateCount }}
        </p>
        <p v-if="validation.warnings.length" class="mt-1 text-xs text-amber-700">
          警告 {{ validation.warnings.length }} 条：{{ formatValidationWarning(validation.warnings[0]) }}
        </p>
      </div>

      <ElAlert v-if="errorMessage" :closable="false" show-icon type="error" :title="errorMessage" />
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <ElButton @click="closeEditor">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="saveSource">保存</ElButton>
      </div>
    </template>
  </ElDialog>

  <ElDialog
    v-model="qrDialogVisible"
    :title="qrTitle ? `${qrTitle} 二维码` : '二维码'"
    width="360px"
    align-center
    :close-on-click-modal="true"
  >
    <div class="flex justify-center py-2">
      <img v-if="qrDataUrl" :src="qrDataUrl" alt="二维码" class="h-64 w-64 rounded-lg border border-gray-200 bg-white p-2" />
    </div>
  </ElDialog>

  <ElDialog
    :model-value="Boolean(deleteTarget)"
    title="确认删除"
    width="420px"
    :close-on-click-modal="false"
    align-center
    @update:model-value="(value) => !value && closeDeleteDialog()"
  >
    <p class="text-sm text-gray-600">删除后不可恢复，确定删除「{{ deleteTarget?.name ?? '' }}」吗？</p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <ElButton @click="closeDeleteDialog">取消</ElButton>
        <ElButton type="danger" :loading="saving" @click="confirmDelete">删除</ElButton>
      </div>
    </template>
  </ElDialog>
</template>
