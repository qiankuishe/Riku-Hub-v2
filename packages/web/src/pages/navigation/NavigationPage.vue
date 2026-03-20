<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTag } from 'element-plus';
import { Icon } from '@iconify/vue';
import type { NavigationCategory, NavigationLink, NoteRecord, SnippetRecord } from '../../api';
import { notesApi, snippetsApi } from '../../api';
import FaviconImage from '../../components/FaviconImage.vue';
import ConfirmModal from '../shared/ConfirmModal.vue';
import { formatDateTime } from '../../utils/date';
import { useNavigationStore } from '../../stores/navigation';
import { useUiStore } from '../../stores/ui';

type SearchEngine = 'google' | 'bing' | 'baidu' | 'github' | 'local';
type LocalSearchType = 'link' | 'note' | 'snippet';

interface LocalSearchItem {
  type: LocalSearchType;
  id: string;
  title: string;
  url?: string;
  desc: string;
}

const uiStore = useUiStore();
const navigationStore = useNavigationStore();
const { categories, totalLinks, recentLinks, saving } = storeToRefs(navigationStore);

const notes = ref<NoteRecord[]>([]);
const snippets = ref<SnippetRecord[]>([]);
const loading = ref(false);
const pageErrorMessage = ref('');
const selectedCategoryId = ref<string | null>(null);
const editMode = ref(false);

const searchEngine = ref<SearchEngine>('google');
const searchQuery = ref('');
const localSearchResults = ref<LocalSearchItem[]>([]);
const searching = ref(false);
let searchTimer: number | undefined;

const categoryDialogVisible = ref(false);
const editingCategory = ref<NavigationCategory | null>(null);
const categoryFormName = ref('');

const linkDialogVisible = ref(false);
const editingLink = ref<NavigationLink | null>(null);
const linkForm = ref({
  categoryId: '',
  title: '',
  url: '',
  description: ''
});

const formErrorMessage = ref('');
const deleteCategoryTarget = ref<NavigationCategory | null>(null);
const deleteLinkTarget = ref<NavigationLink | null>(null);

const draggingLinkId = ref('');
const dragSourceCategoryId = ref('');
const dropCategoryId = ref('');
const dropLinkId = ref('');
const dropPlacement = ref<'' | 'before' | 'after'>('');
const pendingDragChanges = ref(false);
const dragChangeQueue = ref<Array<{ type: 'reorder' | 'move'; categoryId: string; linkIds: string[] }>>([]);
const pendingMoveLinks = ref<Array<{ linkId: string; fromCategoryId: string; toCategoryId: string }>>([]);
const exitEditConfirmVisible = ref(false);

const overviewSectionId = 'nav-overview';

const searchEngines: Record<SearchEngine, { name: string; url: string }> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  github: { name: 'GitHub', url: 'https://github.com/search?q=' },
  local: { name: '站内', url: '' }
};

const searchEngineKeys = Object.keys(searchEngines) as SearchEngine[];
const hasCategories = computed(() => categories.value.length > 0);
const recentLinksPreview = computed(() => recentLinks.value.slice(0, 8));
const categoryDialogTitle = computed(() => (editingCategory.value ? '编辑分类' : '新增分类'));
const linkDialogTitle = computed(() => (editingLink.value ? '编辑链接' : '新增链接'));
const categoryFormValid = computed(() => Boolean(categoryFormName.value.trim()));
const linkFormValid = computed(() => Boolean(linkForm.value.categoryId && linkForm.value.title.trim() && linkForm.value.url.trim()));

watch(
  categories,
  () => {
    if (selectedCategoryId.value && !categories.value.some((category) => category.id === selectedCategoryId.value)) {
      selectedCategoryId.value = null;
    }

    if (
      linkDialogVisible.value &&
      linkForm.value.categoryId &&
      !categories.value.some((category) => category.id === linkForm.value.categoryId)
    ) {
      linkForm.value.categoryId = categories.value[0]?.id ?? '';
    }
  },
  { deep: true, immediate: true }
);

watch(
  [categories, selectedCategoryId],
  () => {
    uiStore.setSecondaryNav({
      title: '导航分类',
      activeKey: selectedCategoryId.value ?? 'all',
      items: [
        {
          key: 'all',
          label: '全部',
          badge: String(totalLinks.value),
          targetId: overviewSectionId
        },
        ...categories.value.map((category) => ({
          key: category.id,
          label: category.name,
          badge: String(category.links.length),
          targetId: getCategorySectionId(category.id)
        }))
      ]
    });
    uiStore.expandSidebarSection('/riku/nav');
  },
  { deep: true, immediate: true }
);

watch(searchQuery, () => {
  if (searchEngine.value !== 'local') {
    localSearchResults.value = [];
    return;
  }

  if (searchTimer) {
    window.clearTimeout(searchTimer);
  }
  searchTimer = window.setTimeout(() => {
    runLocalSearch();
  }, 280);
});

watch(searchEngine, (value) => {
  if (value !== 'local') {
    localSearchResults.value = [];
    return;
  }
  runLocalSearch();
});

onMounted(() => {
  uiStore.expandSidebarSection('/riku/nav');
  void loadAll();
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
  if (searchTimer) {
    window.clearTimeout(searchTimer);
  }
});

function getCategorySectionId(categoryId: string) {
  return `nav-category-${categoryId}`;
}

function resetPendingDragState() {
  pendingDragChanges.value = false;
  dragChangeQueue.value = [];
  pendingMoveLinks.value = [];
}

function syncCategoryLinks(category: NavigationCategory, links: NavigationLink[]) {
  category.links = links.map((link, index) => ({
    ...link,
    categoryId: category.id,
    sortOrder: index
  }));
}

function upsertReorderQueue(categoryId: string, linkIds: string[]) {
  const existing = dragChangeQueue.value.find((entry) => entry.type === 'reorder' && entry.categoryId === categoryId);
  if (existing) {
    existing.linkIds = [...linkIds];
    return;
  }
  dragChangeQueue.value.push({
    type: 'reorder',
    categoryId,
    linkIds: [...linkIds]
  });
}

function upsertMoveQueue(linkId: string, sourceCategoryId: string, targetCategoryId: string) {
  if (sourceCategoryId === targetCategoryId) {
    return;
  }

  dragChangeQueue.value.push({
    type: 'move',
    categoryId: targetCategoryId,
    linkIds: [linkId]
  });

  const existing = pendingMoveLinks.value.find((entry) => entry.linkId === linkId);
  if (!existing) {
    pendingMoveLinks.value.push({ linkId, fromCategoryId: sourceCategoryId, toCategoryId: targetCategoryId });
    return;
  }

  existing.toCategoryId = targetCategoryId;
  if (existing.fromCategoryId === targetCategoryId) {
    pendingMoveLinks.value = pendingMoveLinks.value.filter((entry) => entry.linkId !== linkId);
  }
}

async function loadAll() {
  loading.value = true;
  pageErrorMessage.value = '';
  try {
    await navigationStore.loadAll();
    const [notesData, snippetsData] = await Promise.all([notesApi.getAll(), snippetsApi.getAll({ type: 'all' })]);
    notes.value = notesData.notes;
    snippets.value = snippetsData.snippets;
    resetPendingDragState();
    if (searchEngine.value === 'local' && searchQuery.value.trim()) {
      runLocalSearch();
    }
  } catch (error) {
    pageErrorMessage.value = error instanceof Error ? error.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

function focusCategory(categoryId: string | null) {
  selectedCategoryId.value = categoryId;
  uiStore.setSecondaryNavActive(categoryId ?? 'all');
  if (!categoryId) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  document.getElementById(getCategorySectionId(categoryId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleSearch() {
  const keyword = searchQuery.value.trim();
  if (!keyword) {
    return;
  }

  if (searchEngine.value === 'local') {
    runLocalSearch();
    return;
  }

  window.open(`${searchEngines[searchEngine.value].url}${encodeURIComponent(keyword)}`, '_blank', 'noopener,noreferrer');
}

function runLocalSearch() {
  const needle = searchQuery.value.trim().toLowerCase();
  if (!needle) {
    localSearchResults.value = [];
    return;
  }

  searching.value = true;
  const result: LocalSearchItem[] = [];

  categories.value.forEach((category) => {
    category.links.forEach((link) => {
      if (
        link.title.toLowerCase().includes(needle) ||
        link.description.toLowerCase().includes(needle) ||
        link.url.toLowerCase().includes(needle)
      ) {
        result.push({
          type: 'link',
          id: link.id,
          title: link.title,
          url: link.url,
          desc: `${category.name}${link.description ? ` · ${link.description}` : ''}`
        });
      }
    });
  });

  notes.value.forEach((note) => {
    if (note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle)) {
      result.push({
        type: 'note',
        id: note.id,
        title: note.title || '无标题',
        desc: note.content.replace(/\s+/g, ' ').slice(0, 68) || '空笔记'
      });
    }
  });

  snippets.value.forEach((snippet) => {
    const content = snippet.type === 'image' ? '[图片]' : snippet.content;
    if (snippet.title.toLowerCase().includes(needle) || content.toLowerCase().includes(needle)) {
      result.push({
        type: 'snippet',
        id: snippet.id,
        title: snippet.title || '未命名片段',
        desc: content.replace(/\s+/g, ' ').slice(0, 68)
      });
    }
  });

  localSearchResults.value = result.slice(0, 20);
  searching.value = false;
}

function openCategoryDialog(category?: NavigationCategory) {
  editingCategory.value = category ?? null;
  categoryFormName.value = category?.name ?? '';
  formErrorMessage.value = '';
  categoryDialogVisible.value = true;
}

function closeCategoryDialog() {
  categoryDialogVisible.value = false;
  editingCategory.value = null;
  categoryFormName.value = '';
  formErrorMessage.value = '';
}

function openLinkDialog(link?: NavigationLink, categoryId?: string) {
  editingLink.value = link ?? null;
  linkForm.value = {
    categoryId: link?.categoryId ?? categoryId ?? categories.value[0]?.id ?? '',
    title: link?.title ?? '',
    url: link?.url ?? '',
    description: link?.description ?? ''
  };
  formErrorMessage.value = '';
  linkDialogVisible.value = true;
}

function closeLinkDialog() {
  linkDialogVisible.value = false;
  editingLink.value = null;
  linkForm.value = {
    categoryId: '',
    title: '',
    url: '',
    description: ''
  };
  formErrorMessage.value = '';
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

async function saveCategory() {
  const name = categoryFormName.value.trim();
  if (!name) {
    formErrorMessage.value = '分类名称不能为空';
    return;
  }

  try {
    const wasEditing = Boolean(editingCategory.value);
    const category = editingCategory.value
      ? await navigationStore.updateCategory(editingCategory.value.id, name)
      : await navigationStore.createCategory(name);
    closeCategoryDialog();
    pageErrorMessage.value = '';
    await nextTick();
    focusCategory(category.id);
    uiStore.showToast(wasEditing ? '分类已更新' : '分类已创建');
  } catch (error) {
    formErrorMessage.value = error instanceof Error ? error.message : '保存失败';
  }
}

async function saveLink() {
  if (!linkForm.value.categoryId || !linkForm.value.title.trim() || !linkForm.value.url.trim()) {
    formErrorMessage.value = '分类、名称、链接不能为空';
    return;
  }

  const payload = {
    categoryId: linkForm.value.categoryId,
    title: linkForm.value.title.trim(),
    url: normalizeUrl(linkForm.value.url),
    description: linkForm.value.description.trim()
  };

  try {
    if (editingLink.value) {
      await navigationStore.updateLink(editingLink.value.id, payload);
      uiStore.showToast('链接已更新');
    } else {
      await navigationStore.createLink(payload);
      uiStore.showToast('链接已创建');
    }
    closeLinkDialog();
    pageErrorMessage.value = '';
    await nextTick();
    focusCategory(payload.categoryId);
  } catch (error) {
    formErrorMessage.value = error instanceof Error ? error.message : '保存失败';
  }
}

async function confirmDeleteCategory() {
  if (!deleteCategoryTarget.value) {
    return;
  }

  try {
    const deletedId = deleteCategoryTarget.value.id;
    await navigationStore.deleteCategory(deletedId);
    if (selectedCategoryId.value === deletedId) {
      focusCategory(null);
    }
    deleteCategoryTarget.value = null;
    pageErrorMessage.value = '';
    uiStore.showToast('分类已删除');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除失败');
  }
}

async function confirmDeleteLink() {
  if (!deleteLinkTarget.value) {
    return;
  }

  try {
    await navigationStore.deleteLink(deleteLinkTarget.value.id);
    deleteLinkTarget.value = null;
    pageErrorMessage.value = '';
    uiStore.showToast('链接已删除');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除失败');
  }
}

async function handleOpenLink(link: NavigationLink) {
  window.open(link.url, '_blank', 'noopener,noreferrer');
  try {
    await navigationStore.recordVisit(link.id);
  } catch {
    // noop
  }
}

async function handleLocalResultClick(item: LocalSearchItem) {
  if (item.type === 'link' && item.url) {
    const link = categories.value.flatMap((category) => category.links).find((entry) => entry.id === item.id);
    if (link) {
      await handleOpenLink(link);
      return;
    }
    window.open(item.url, '_blank', 'noopener,noreferrer');
    return;
  }

  if (item.type === 'note') {
    window.location.assign(`/notes?focus=${encodeURIComponent(item.id)}`);
    return;
  }

  window.location.assign(`/snippets?focus=${encodeURIComponent(item.id)}`);
}

function localResultTagType(type: LocalSearchType) {
  if (type === 'link') {
    return 'success';
  }
  if (type === 'note') {
    return 'warning';
  }
  return 'info';
}

function getLink(categoryId: string, linkId: string) {
  return categories.value.find((entry) => entry.id === categoryId)?.links.find((link) => link.id === linkId) ?? null;
}

function onLinkDragStart(event: DragEvent, link: NavigationLink) {
  draggingLinkId.value = link.id;
  dragSourceCategoryId.value = link.categoryId;
  dropCategoryId.value = link.categoryId;
  dropLinkId.value = '';
  dropPlacement.value = '';
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', link.id);
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onLinkDragEnd() {
  draggingLinkId.value = '';
  dragSourceCategoryId.value = '';
  dropCategoryId.value = '';
  dropLinkId.value = '';
  dropPlacement.value = '';
}

function onLinkDragOver(event: DragEvent, link: NavigationLink) {
  event.preventDefault();

  if (draggingLinkId.value === link.id) {
    dropLinkId.value = '';
    dropPlacement.value = '';
    return;
  }

  const element = event.currentTarget as HTMLElement | null;
  const rect = element?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  const mouseX = event.clientX - rect.left;
  const centerX = rect.width / 2;
  const isLeft = mouseX < centerX;

  dropCategoryId.value = link.categoryId;
  dropLinkId.value = link.id;
  dropPlacement.value = isLeft ? 'before' : 'after';
}

function onCategoryDragOver(_event: DragEvent, categoryId: string) {
  dropCategoryId.value = categoryId;
  dropLinkId.value = '';
  dropPlacement.value = '';
}

async function onLinkDrop(event: DragEvent, link: NavigationLink) {
  const element = event.currentTarget as HTMLElement | null;
  const rect = element?.getBoundingClientRect();
  const after = dropLinkId.value === link.id
    ? dropPlacement.value === 'after'
    : rect
      ? event.clientX - rect.left > rect.width / 2
      : false;
  await performLinkDrop(link.categoryId, link.id, after);
}

async function onCategoryDropZone(_event: DragEvent, categoryId: string) {
  await performLinkDrop(categoryId, null, false);
}

async function performLinkDrop(targetCategoryId: string, targetLinkId: string | null, insertAfter: boolean) {
  const sourceLinkId = draggingLinkId.value;
  const sourceCategoryId = dragSourceCategoryId.value;
  if (!sourceLinkId || !sourceCategoryId) {
    onLinkDragEnd();
    return;
  }

  if (sourceCategoryId === targetCategoryId && targetLinkId === sourceLinkId) {
    onLinkDragEnd();
    return;
  }

  const sourceCategory = categories.value.find((category) => category.id === sourceCategoryId);
  const targetCategory = categories.value.find((category) => category.id === targetCategoryId);
  const sourceLink = getLink(sourceCategoryId, sourceLinkId);
  if (!sourceCategory || !targetCategory || !sourceLink) {
    onLinkDragEnd();
    return;
  }

  if (sourceCategoryId === targetCategoryId) {
    const ids = sourceCategory.links.map((entry) => entry.id).filter((id) => id !== sourceLinkId);
    const targetIndex = targetLinkId ? ids.indexOf(targetLinkId) : -1;
    const insertIndex = targetLinkId ? Math.max(0, targetIndex + (insertAfter ? 1 : 0)) : ids.length;
    ids.splice(insertIndex, 0, sourceLinkId);
    const newLinks = ids.map((id) => sourceCategory.links.find((link) => link.id === id)).filter((link): link is NavigationLink => Boolean(link));
    syncCategoryLinks(sourceCategory, newLinks);
    upsertReorderQueue(sourceCategory.id, sourceCategory.links.map((link) => link.id));
    pendingDragChanges.value = true;
    pageErrorMessage.value = '';
    onLinkDragEnd();
    return;
  }

  const sourceIds = sourceCategory.links.map((entry) => entry.id).filter((id) => id !== sourceLinkId);
  const targetIds = targetCategory.links.map((entry) => entry.id).filter((id) => id !== sourceLinkId);
  const targetIndex = targetLinkId ? targetIds.indexOf(targetLinkId) : -1;
  const insertIndex = targetLinkId ? Math.max(0, targetIndex + (insertAfter ? 1 : 0)) : targetIds.length;
  targetIds.splice(insertIndex, 0, sourceLinkId);

  const sourceLinks = sourceIds
    .map((id) => sourceCategory.links.find((link) => link.id === id))
    .filter((link): link is NavigationLink => Boolean(link));
  syncCategoryLinks(sourceCategory, sourceLinks);

  const movedLink: NavigationLink = { ...sourceLink, categoryId: targetCategoryId };
  const targetLinks = targetIds
    .map((id) => (id === sourceLinkId ? movedLink : targetCategory.links.find((link) => link.id === id)))
    .filter((link): link is NavigationLink => Boolean(link));
  syncCategoryLinks(targetCategory, targetLinks);

  upsertMoveQueue(sourceLinkId, sourceCategoryId, targetCategoryId);
  upsertReorderQueue(sourceCategory.id, sourceCategory.links.map((link) => link.id));
  upsertReorderQueue(targetCategory.id, targetCategory.links.map((link) => link.id));
  pendingDragChanges.value = true;
  pageErrorMessage.value = '';
  onLinkDragEnd();
}

async function saveDragChanges() {
  if (!pendingDragChanges.value) {
    return;
  }

  try {
    for (const move of pendingMoveLinks.value) {
      if (move.fromCategoryId !== move.toCategoryId) {
        await navigationStore.updateLink(move.linkId, { categoryId: move.toCategoryId });
      }
    }

    const changedCategories = dragChangeQueue.value
      .filter((entry) => entry.type === 'reorder')
      .map((entry) => entry.categoryId);
    const categoryIds = [...new Set(changedCategories)];
    const reorderTasks = categoryIds.map((categoryId) => {
      const category = categories.value.find((entry) => entry.id === categoryId);
      if (!category) {
        return Promise.resolve();
      }
      const linkIds = category.links.map((link) => link.id);
      return navigationStore.reorderLinks(category.id, linkIds);
    });

    await Promise.all(reorderTasks);
    resetPendingDragState();
    uiStore.showToast('排序已保存');
    pageErrorMessage.value = '';
    window.setTimeout(() => {
      void loadAll();
    }, 800);
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '保存失败');
    resetPendingDragState();
    await loadAll();
  }
}

function handleEditModeToggle() {
  if (editMode.value && pendingDragChanges.value) {
    exitEditConfirmVisible.value = true;
    return;
  }
  editMode.value = !editMode.value;
}

function confirmExitEdit(shouldSave: boolean) {
  exitEditConfirmVisible.value = false;

  if (shouldSave) {
    void saveDragChanges().then(() => {
      editMode.value = false;
    });
    return;
  }

  resetPendingDragState();
  editMode.value = false;
  void loadAll();
}

function cancelExitEdit() {
  exitEditConfirmVisible.value = false;
}

async function moveCategoryUp(category: NavigationCategory) {
  const index = categories.value.indexOf(category);
  if (index <= 0) {
    return;
  }

  const newCategories = [...categories.value];
  [newCategories[index - 1], newCategories[index]] = [newCategories[index], newCategories[index - 1]];

  try {
    await navigationStore.reorderCategories(newCategories.map((cat) => cat.id));
    uiStore.showToast('分类已上移');
    pageErrorMessage.value = '';
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '移动失败');
    await loadAll();
  }
}

async function moveCategoryDown(category: NavigationCategory) {
  const index = categories.value.indexOf(category);
  if (index < 0 || index >= categories.value.length - 1) {
    return;
  }

  const newCategories = [...categories.value];
  [newCategories[index], newCategories[index + 1]] = [newCategories[index + 1], newCategories[index]];

  try {
    await navigationStore.reorderCategories(newCategories.map((cat) => cat.id));
    uiStore.showToast('分类已下移');
    pageErrorMessage.value = '';
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '移动失败');
    await loadAll();
  }
}
</script>

<template>
  <div class="grid gap-4">
    <section class="card" :id="overviewSectionId">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">网站导航</h2>
          <p class="text-sm text-gray-500">支持分类、链接、搜索和拖拽排序。</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ElButton
            v-if="editMode"
            type="primary"
            size="small"
            :loading="saving"
            :disabled="!pendingDragChanges || saving"
            @click="saveDragChanges"
          >
            <Icon icon="carbon:save" class="mr-1" />
            保存排序
          </ElButton>
          <ElButton v-if="editMode" size="small" :disabled="loading || saving" @click="openCategoryDialog()">
            <Icon icon="carbon:folder-add" class="mr-1" />
            新增分类
          </ElButton>
          <ElButton v-if="editMode && hasCategories" type="primary" size="small" :disabled="loading || saving" @click="openLinkDialog()">
            <Icon icon="carbon:add-alt" class="mr-1" />
            新增站点
          </ElButton>
          <ElButton size="small" :loading="loading" @click="loadAll">
            <Icon icon="carbon:renew" class="mr-1" />
            {{ loading ? '刷新中...' : '刷新' }}
          </ElButton>
          <ElButton size="small" :type="editMode ? 'primary' : 'default'" @click="handleEditModeToggle">
            <Icon :icon="editMode ? 'carbon:checkmark-outline' : 'carbon:edit'" class="mr-1" />
            {{ editMode ? '完成编辑' : '进入编辑' }}
          </ElButton>
        </div>
      </div>

      <div class="mb-3 grid gap-3">
        <ElRadioGroup v-model="searchEngine" size="small" class="w-fit">
          <ElRadioButton v-for="engine in searchEngineKeys" :key="engine" :value="engine">
            {{ searchEngines[engine].name }}
          </ElRadioButton>
        </ElRadioGroup>
        <div class="flex flex-wrap items-center gap-2">
          <ElInput
            v-model="searchQuery"
            clearable
            size="small"
            class="min-w-[220px] flex-1"
            :placeholder="searchEngine === 'local' ? '搜索站内内容...' : `搜索 ${searchEngines[searchEngine].name}...`"
            @keydown.enter.prevent="handleSearch"
          />
          <ElButton v-if="searchEngine !== 'local'" type="primary" size="small" @click="handleSearch">
            <Icon icon="carbon:search" class="mr-1" />
            搜索
          </ElButton>
        </div>
      </div>

      <div v-if="searchEngine === 'local' && searchQuery.trim()" class="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <p class="mb-2 text-xs text-gray-500">
          {{ searching ? '搜索中...' : `找到 ${localSearchResults.length} 条结果` }}
        </p>
        <div class="grid gap-2">
          <button
            v-for="item in localSearchResults"
            :key="`${item.type}-${item.id}`"
            type="button"
            class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-gray-400 hover:bg-gray-50"
            @click="handleLocalResultClick(item)"
          >
            <div class="mb-1 flex items-center gap-2">
              <ElTag size="small" :type="localResultTagType(item.type)">{{ item.type }}</ElTag>
              <strong class="text-sm text-gray-900">{{ item.title }}</strong>
            </div>
            <p class="text-xs text-gray-600">{{ item.desc }}</p>
          </button>
          <div v-if="!localSearchResults.length && !searching" class="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">
            没有匹配内容
          </div>
        </div>
      </div>
    </section>

    <section v-if="!editMode && recentLinksPreview.length && (searchEngine !== 'local' || !searchQuery.trim())" class="card">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="text-lg font-semibold text-gray-900">最近访问</h3>
        <span class="text-sm text-gray-500">{{ recentLinksPreview.length }} 条</span>
      </div>
      <div class="nav-link-grid">
        <article
          v-for="link in recentLinksPreview"
          :key="link.id"
          class="nav-link-card cursor-pointer"
          @click="handleOpenLink(link)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <FaviconImage :url="link.url" :title="link.title" />
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-gray-900">{{ link.title }}</div>
              <p class="truncate text-xs text-gray-500">{{ link.description || '无描述' }}</p>
            </div>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            {{ link.categoryName }} · 访问 {{ link.visitCount }} 次 ·
            {{ formatDateTime(link.lastVisitedAt ?? undefined, '未访问') }}
          </p>
        </article>
      </div>
    </section>

    <section v-if="loading" class="card">
      <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">加载中...</div>
    </section>

    <section v-else-if="pageErrorMessage" class="card">
      <ElAlert :closable="false" show-icon type="error" :title="pageErrorMessage" />
    </section>

    <section v-else-if="!categories.length" class="card">
      <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
        暂无分类。点击“进入编辑”开始创建。
      </div>
    </section>

    <div v-else class="grid gap-4">
      <div
        v-for="category in categories"
        :key="category.id"
        class="rounded-xl transition"
        :class="{
          'category-drop-zone': editMode && dropCategoryId === category.id && !dropLinkId && dragSourceCategoryId !== category.id,
          'bg-gray-50': editMode && dropCategoryId === category.id && !dropLinkId && dragSourceCategoryId !== category.id
        }"
        @dragover.prevent="editMode && onCategoryDragOver($event, category.id)"
        @drop.prevent="editMode && onCategoryDropZone($event, category.id)"
      >
        <section class="card" :id="getCategorySectionId(category.id)" :class="{ 'ring-2 ring-black/20': selectedCategoryId === category.id }">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <h3 class="text-lg font-semibold text-gray-900">
              {{ category.name }}
              <span class="text-sm font-normal text-gray-500">({{ category.links.length }})</span>
            </h3>
            <div v-if="editMode" class="flex flex-wrap items-center gap-2">
              <div class="flex items-center gap-1">
                <button
                  class="nav-category-move-btn"
                  type="button"
                  title="上移分类"
                  :disabled="categories.indexOf(category) === 0"
                  @click="moveCategoryUp(category)"
                >
                  <Icon icon="carbon:chevron-up" />
                </button>
                <button
                  class="nav-category-move-btn"
                  type="button"
                  title="下移分类"
                  :disabled="categories.indexOf(category) === categories.length - 1"
                  @click="moveCategoryDown(category)"
                >
                  <Icon icon="carbon:chevron-down" />
                </button>
              </div>
              <ElButton size="small" @click="openLinkDialog(undefined, category.id)">新增链接</ElButton>
              <ElButton size="small" @click="openCategoryDialog(category)">编辑分类</ElButton>
              <ElButton size="small" type="danger" @click="deleteCategoryTarget = category">删除分类</ElButton>
            </div>
          </div>

          <div class="nav-link-grid">
            <article
              v-for="link in category.links"
              :key="link.id"
              class="nav-link-card"
              :class="{
                'is-dragging': draggingLinkId === link.id,
                'is-drop-target': dropLinkId === link.id,
                'drop-before': dropLinkId === link.id && dropPlacement === 'before',
                'drop-after': dropLinkId === link.id && dropPlacement === 'after',
                'cursor-pointer': !editMode
              }"
              :draggable="editMode"
              @click="!editMode && handleOpenLink(link)"
              @dragstart.stop="editMode && onLinkDragStart($event, link)"
              @dragend.stop="editMode && onLinkDragEnd()"
              @dragover.prevent.stop="editMode && onLinkDragOver($event, link)"
              @drop.prevent.stop="editMode && onLinkDrop($event, link)"
            >
              <div class="flex items-center gap-2 min-w-0">
                <FaviconImage :url="link.url" :title="link.title" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-gray-900">{{ link.title }}</div>
                  <p class="truncate text-xs text-gray-500">{{ link.description || '无描述' }}</p>
                </div>
              </div>

              <p class="mt-2 text-xs text-gray-500">
                访问 {{ link.visitCount }} 次 · {{ formatDateTime(link.lastVisitedAt ?? undefined, '未访问') }}
              </p>

              <div v-if="editMode" class="mt-2 flex justify-end gap-1">
                <ElButton size="small" text @click.stop="openLinkDialog(link)">
                  <Icon icon="carbon:edit" />
                </ElButton>
                <ElButton size="small" text type="danger" @click.stop="deleteLinkTarget = link">
                  <Icon icon="carbon:trash-can" />
                </ElButton>
              </div>
            </article>

            <button
              v-if="editMode"
              type="button"
              class="nav-link-card border-dashed text-left transition hover:border-gray-400 hover:bg-gray-50"
              @click="openLinkDialog(undefined, category.id)"
            >
              <div class="flex items-center gap-2">
                <span class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-400 text-gray-700">
                  <Icon icon="carbon:add" />
                </span>
                <span class="text-sm font-medium text-gray-700">新增链接</span>
              </div>
            </button>
          </div>
        </section>
      </div>
    </div>

    <ElDialog
      v-model="categoryDialogVisible"
      :title="categoryDialogTitle"
      width="460px"
      :close-on-click-modal="false"
      align-center
      @close="closeCategoryDialog"
    >
      <ElForm label-position="top">
        <ElFormItem label="分类名称">
          <ElInput v-model="categoryFormName" size="small" placeholder="请输入分类名称" />
        </ElFormItem>
      </ElForm>
      <ElAlert v-if="formErrorMessage" class="mt-2" :closable="false" show-icon type="error" :title="formErrorMessage" />
      <template #footer>
        <div class="flex justify-end gap-2">
          <ElButton size="small" @click="closeCategoryDialog">取消</ElButton>
          <ElButton type="primary" size="small" :loading="saving" :disabled="saving || !categoryFormValid" @click="saveCategory">保存</ElButton>
        </div>
      </template>
    </ElDialog>

    <ElDialog
      v-model="linkDialogVisible"
      :title="linkDialogTitle"
      width="680px"
      :close-on-click-modal="false"
      align-center
      @close="closeLinkDialog"
    >
      <ElForm label-position="top" class="grid gap-2">
        <ElFormItem label="分类">
          <ElSelect v-model="linkForm.categoryId" size="small" class="w-full" placeholder="选择分类">
            <ElOption v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="名称">
          <ElInput v-model="linkForm.title" size="small" placeholder="站点名称" />
        </ElFormItem>
        <ElFormItem label="链接">
          <ElInput v-model="linkForm.url" size="small" placeholder="https://example.com" />
        </ElFormItem>
        <ElFormItem label="描述">
          <ElInput v-model="linkForm.description" size="small" type="textarea" :rows="4" placeholder="可选的链接说明" />
        </ElFormItem>
      </ElForm>
      <ElAlert v-if="formErrorMessage" class="mt-2" :closable="false" show-icon type="error" :title="formErrorMessage" />
      <template #footer>
        <div class="flex justify-end gap-2">
          <ElButton size="small" @click="closeLinkDialog">取消</ElButton>
          <ElButton type="primary" size="small" :loading="saving" :disabled="saving || !linkFormValid" @click="saveLink">保存</ElButton>
        </div>
      </template>
    </ElDialog>

    <ConfirmModal
      :open="Boolean(deleteCategoryTarget)"
      title="删除分类"
      :message="`确认删除「${deleteCategoryTarget?.name ?? '未命名分类'}」？该分类下的 ${deleteCategoryTarget?.links.length ?? 0} 个链接也会一并删除。`"
      confirm-text="删除"
      @close="deleteCategoryTarget = null"
      @confirm="confirmDeleteCategory"
    />

    <ConfirmModal
      :open="Boolean(deleteLinkTarget)"
      title="删除链接"
      :message="`确认删除「${deleteLinkTarget?.title ?? '未命名链接'}」？`"
      confirm-text="删除"
      @close="deleteLinkTarget = null"
      @confirm="confirmDeleteLink"
    />

    <ElDialog
      v-model="exitEditConfirmVisible"
      title="未保存的更改"
      width="460px"
      :close-on-click-modal="false"
      align-center
      @close="cancelExitEdit"
    >
      <div class="py-4">
        <div class="mb-4 flex items-start gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <Icon icon="carbon:warning" class="text-xl text-amber-600" />
          </div>
          <div class="flex-1">
            <p class="text-base font-medium text-gray-900">有未保存的排序更改</p>
            <p class="mt-1 text-sm text-gray-600">您对链接顺序进行了调整，但尚未保存。是否要保存这些更改？</p>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <ElButton size="small" @click="cancelExitEdit">取消</ElButton>
          <ElButton size="small" @click="confirmExitEdit(false)">放弃更改</ElButton>
          <ElButton type="primary" size="small" @click="confirmExitEdit(true)">保存更改</ElButton>
        </div>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.nav-link-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.nav-link-card {
  position: relative;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 12px;
  min-height: 72px;
  overflow: visible;
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}

.nav-link-card:hover {
  border-color: #9ca3af;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.08);
}

.nav-link-card.is-dragging {
  opacity: 0.35;
}

.nav-link-card.is-drop-target {
  border: 2px solid #111111;
  background: #f9fafb;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: scale(1.008);
}

.nav-link-card.drop-before {
  border-left: 4px dashed #111111 !important;
  border-right: 2px solid #9ca3af !important;
  box-shadow: inset 8px 0 0 rgba(17, 17, 17, 0.05), 0 4px 12px rgba(0, 0, 0, 0.1);
}

.nav-link-card.drop-after {
  border-right: 4px dashed #111111 !important;
  border-left: 2px solid #9ca3af !important;
  box-shadow: inset -8px 0 0 rgba(17, 17, 17, 0.05), 0 4px 12px rgba(0, 0, 0, 0.1);
}

.nav-category-move-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #111111;
  cursor: pointer;
  transition: all 150ms ease;
}

.nav-category-move-btn:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.nav-category-move-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.category-drop-zone {
  background: #f9fafb;
  border: 2px dashed #9ca3af;
  border-radius: 12px;
  padding: 8px;
}

@media (max-width: 1500px) {
  .nav-link-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 1240px) {
  .nav-link-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .nav-link-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .nav-link-grid {
    grid-template-columns: 1fr;
  }
}
</style>
