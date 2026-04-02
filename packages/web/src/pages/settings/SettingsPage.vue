<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElAlert, ElDialog, ElTag, ElSwitch } from 'element-plus';
import { Icon } from '@iconify/vue';
import { authApi, settingsApi, type SettingsBackupPayload, type SettingsExportStats } from '../../api';
import { useUiStore } from '../../stores/ui';
import UiButton from '../../components/ui/UiButton.vue';

type DangerScope = 'sources' | 'navigation' | 'notes' | 'snippets' | 'clipboard' | 'all';

interface DangerAction {
  scope: DangerScope;
  title: string;
  description: string;
}

const uiStore = useUiStore();

const currentOrigin = computed(() => window.location.origin);
const stats = ref<SettingsExportStats | null>(null);
const loadingStats = ref(false);
const exporting = ref(false);
const importing = ref(false);
const clearing = ref<DangerScope | null>(null);
const dangerTarget = ref<DangerAction | null>(null);
const importError = ref('');

// Auto redirect settings
const autoRedirectEnabled = ref(false);
const loadingAutoRedirect = ref(false);
const savingAutoRedirect = ref(false);

const dataSectionId = 'settings-data';
const behaviorSectionId = 'settings-behavior';
const dangerSectionId = 'settings-danger';
const accountSectionId = 'settings-account';
const fileInputRef = ref<HTMLInputElement | null>(null);

const dangerActions: DangerAction[] = [
  { scope: 'sources', title: '清空订阅源', description: '删除全部订阅源数据。' },
  { scope: 'navigation', title: '清空导航', description: '删除全部分类与链接。' },
  { scope: 'notes', title: '清空笔记', description: '删除全部笔记内容。' },
  { scope: 'snippets', title: '清空剪贴板（主）', description: '删除主剪贴板页面使用的数据。' },
  { scope: 'clipboard', title: '清空剪贴板（兼容）', description: '删除兼容接口使用的剪贴板条目。' },
  { scope: 'all', title: '全部清空', description: '删除所有业务数据。' }
];

const statsItems = computed(() => {
  const current = stats.value;
  const clipboardTotal = current ? (current.snippets ?? 0) + (current.clipboardItems ?? 0) : loadingStats.value ? -1 : 0;
  return [
    { key: 'sources', label: '订阅源', value: current?.sources ?? (loadingStats.value ? -1 : 0), icon: 'carbon:rss' },
    { key: 'navigationCategories', label: '导航分类', value: current?.navigationCategories ?? (loadingStats.value ? -1 : 0), icon: 'carbon:categories' },
    { key: 'navigationLinks', label: '导航链接', value: current?.navigationLinks ?? (loadingStats.value ? -1 : 0), icon: 'carbon:link' },
    { key: 'notes', label: '笔记', value: current?.notes ?? (loadingStats.value ? -1 : 0), icon: 'carbon:notebook' },
    { key: 'clipboard', label: '剪贴板', value: clipboardTotal, icon: 'carbon:paste' }
  ];
});

onMounted(() => {
  uiStore.setSecondaryNav({
    title: '系统设置',
    activeKey: 'data',
    items: [
      { key: 'data', label: '数据管理', targetId: dataSectionId },
      { key: 'behavior', label: '行为设置', targetId: behaviorSectionId },
      { key: 'danger', label: '危险区域', targetId: dangerSectionId },
      { key: 'account', label: '账户', targetId: accountSectionId }
    ]
  });
  void loadStats();
  void loadAutoRedirectSetting();
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
});

async function loadStats() {
  loadingStats.value = true;
  try {
    const data = await settingsApi.getExportStats();
    stats.value = data.stats;
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '读取统计失败');
  } finally {
    loadingStats.value = false;
  }
}

async function loadAutoRedirectSetting() {
  loadingAutoRedirect.value = true;
  try {
    const result = await settingsApi.getSetting('auto_redirect_to_dashboard');
    autoRedirectEnabled.value = result.value === 'true';
  } catch (error) {
    // Default to false if setting doesn't exist
    autoRedirectEnabled.value = false;
  } finally {
    loadingAutoRedirect.value = false;
  }
}

async function saveAutoRedirectSetting() {
  savingAutoRedirect.value = true;
  try {
    if (autoRedirectEnabled.value) {
      await settingsApi.setSetting('auto_redirect_to_dashboard', 'true');
    } else {
      await settingsApi.deleteSetting('auto_redirect_to_dashboard');
    }
    uiStore.showToast(autoRedirectEnabled.value ? '已启用自动跳转' : '已禁用自动跳转');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '保存设置失败');
    // Revert the switch state on error
    autoRedirectEnabled.value = !autoRedirectEnabled.value;
  } finally {
    savingAutoRedirect.value = false;
  }
}

async function exportData() {
  exporting.value = true;
  try {
    const data = await settingsApi.exportData();
    const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `riku-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1200);
    uiStore.showToast('导出完成');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

function triggerImportSelect() {
  importError.value = '';
  fileInputRef.value?.click();
}

async function importData(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  importing.value = true;
  importError.value = '';
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as SettingsBackupPayload;
    const data = await settingsApi.importData(parsed);
    const skippedNavigationCount = data.skipped?.navigation?.count ?? 0;
    const baseMessage = data.message || '导入完成';
    uiStore.showToast(skippedNavigationCount > 0 ? `${baseMessage}，跳过 ${skippedNavigationCount} 条非法导航链接` : baseMessage);
    await loadStats();
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '导入失败';
    uiStore.showToast(importError.value);
  } finally {
    importing.value = false;
    input.value = '';
  }
}

function openDangerDialog(action: DangerAction) {
  dangerTarget.value = action;
}

async function runDangerAction() {
  if (!dangerTarget.value) {
    return;
  }
  const scope = dangerTarget.value.scope;
  clearing.value = scope;
  try {
    await settingsApi.clearData(scope);
    uiStore.showToast(`${dangerTarget.value.title}完成`);
    dangerTarget.value = null;
    await loadStats();
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '操作失败');
  } finally {
    clearing.value = null;
  }
}

async function logout() {
  await authApi.logout().catch(() => undefined);
  window.location.replace('/login');
}
</script>

<template>
  <div class="grid gap-4">
    <section class="card" :id="dataSectionId">
      <div class="mb-4">
        <div class="settings-title-row">
          <button type="button" class="mobile-menu-btn" @click="uiStore.openMobileNav">
            <Icon icon="carbon:menu" />
          </button>
          <div class="settings-title-content justify-center flex flex-col">
            <h2 class="text-xl font-semibold text-gray-900">数据管理</h2>
          </div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div v-for="item in statsItems" :key="item.key" class="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="text-xs text-gray-500">{{ item.label }}</p>
            <Icon :icon="item.icon" class="text-gray-400" />
          </div>
          <p class="text-xl font-semibold text-gray-900">
            {{ item.value < 0 ? '...' : item.value }}
          </p>
        </div>
      </div>

      <div class="mt-4 toolbar-actions">
        <UiButton type="primary" size="small" :loading="exporting" :disabled="exporting" @click="exportData">
          <Icon icon="carbon:download" class="mr-1" />
          导出
        </UiButton>
        <UiButton size="small" :loading="importing" :disabled="importing" @click="triggerImportSelect">
          <Icon icon="carbon:upload" class="mr-1" />
          {{ importing ? '导入中...' : '导入' }}
        </UiButton>
        <input ref="fileInputRef" type="file" accept=".json,application/json" class="hidden" @change="importData" />
      </div>

      <ElAlert v-if="importError" class="mt-3" :closable="false" show-icon type="error" :title="importError" />
    </section>

    <section class="card" :id="behaviorSectionId">
      <div class="mb-4">
        <h2 class="text-xl font-semibold text-gray-900">行为设置</h2>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-semibold text-gray-900">自动跳转到后台</h3>
            <p class="mt-1 text-xs text-gray-500">登录状态下访问主页时自动跳转到导航页面</p>
          </div>
          <ElSwitch
            v-model="autoRedirectEnabled"
            :loading="loadingAutoRedirect || savingAutoRedirect"
            :disabled="loadingAutoRedirect || savingAutoRedirect"
            @change="saveAutoRedirectSetting"
          />
        </div>
      </div>
    </section>

    <section class="card" :id="dangerSectionId">
      <div class="mb-4">
        <h2 class="text-xl font-semibold text-gray-900">危险区域</h2>
      </div>

      <div class="grid gap-3">
        <article
          v-for="action in dangerActions"
          :key="action.scope"
          class="rounded-xl border border-red-200 bg-red-50/45 px-4 py-3"
        >
          <div class="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold text-red-900">{{ action.title }}</h3>
              <p class="mt-1 text-xs text-red-700/90">{{ action.description }}</p>
            </div>
            <UiButton size="small" type="danger" :loading="clearing === action.scope" @click="openDangerDialog(action)">
              {{ clearing === action.scope ? '处理中...' : '执行' }}
            </UiButton>
          </div>
        </article>
      </div>
    </section>

    <section class="card" :id="accountSectionId">
      <div class="mb-4">
        <h2 class="text-xl font-semibold text-gray-900">账户</h2>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p class="text-xs text-gray-500">当前域名</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <ElTag type="info">{{ currentOrigin }}</ElTag>
        </div>
      </div>

      <div class="mt-4">
        <UiButton type="danger" size="small" @click="logout">
          <Icon icon="carbon:logout" class="mr-1" />
          退出登录
        </UiButton>
      </div>
    </section>

    <ElDialog
      :model-value="Boolean(dangerTarget)"
      :title="dangerTarget?.title ?? '确认操作'"
      width="460px"
      :close-on-click-modal="false"
      align-center
      @update:model-value="(value) => !value && (dangerTarget = null)"
    >
      <div class="grid gap-2">
        <p class="text-sm text-gray-700">{{ dangerTarget?.description }}</p>
        <ElAlert :closable="false" show-icon type="warning" title="此操作不可撤销，确认继续？" />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton size="small" @click="dangerTarget = null">取消</UiButton>
          <UiButton type="danger" size="small" :loading="Boolean(clearing)" :disabled="Boolean(clearing)" @click="runDangerAction">确认</UiButton>
        </div>
      </template>
    </ElDialog>
  </div>
</template>


<style scoped>
.settings-title-row {
  display: flex;
  align-items: center;
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
