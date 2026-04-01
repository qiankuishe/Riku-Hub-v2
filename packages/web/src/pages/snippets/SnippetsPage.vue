<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElAlert, ElDialog, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTag } from 'element-plus';
import { Icon } from '@iconify/vue';
import type { SnippetRecord, SnippetType } from '../../api';
import { snippetsApi } from '../../api';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';
import ConfirmModal from '../shared/ConfirmModal.vue';
import UiButton from '../../components/ui/UiButton.vue';

const uiStore = useUiStore();
const query = new URLSearchParams(window.location.search);
const initialType = query.get('type');
const initialFocus = query.get('focus');
const initialKeyword = query.get('q');

const snippets = ref<SnippetRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const searchQuery = ref(initialKeyword ?? '');
const filterType = ref<SnippetType | 'all'>(
  initialType && ['text', 'code', 'link', 'image', 'all'].includes(initialType)
    ? (initialType as SnippetType | 'all')
    : 'all'
);
const highlightedId = ref<string | null>(initialFocus);
const pageErrorMessage = ref('');

const draftType = ref<SnippetType>('text');
const draftTitle = ref('');
const draftContent = ref('');
const draftError = ref('');
const clipboardBusy = ref<'idle' | 'text' | 'image'>('idle');
const imageUploadInput = ref<HTMLInputElement | null>(null);

const editDialogOpen = ref(false);
const editingSnippet = ref<SnippetRecord | null>(null);
const editType = ref<SnippetType>('text');
const editTitle = ref('');
const editContent = ref('');
const editErrorMessage = ref('');
const deleteTarget = ref<SnippetRecord | null>(null);
const IMAGE_LIMIT_BYTES = 340 * 1024;

// 瀑布流布局
const leftColumn = ref<SnippetRecord[]>([]);
const rightColumn = ref<SnippetRecord[]>([]);
const expandedSnippets = ref<Set<string>>(new Set());

const typeOptions: Array<{ key: SnippetType; label: string; icon: string }> = [
  { key: 'text', label: '文本', icon: 'carbon:text-align-left' },
  { key: 'code', label: '代码', icon: 'carbon:code' },
  { key: 'link', label: '链接', icon: 'carbon:link' },
  { key: 'image', label: '图片', icon: 'carbon:image' }
];

const filtered = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  return snippets.value.filter((snippet) => {
    if (filterType.value !== 'all' && snippet.type !== filterType.value) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const hay = `${snippet.title} ${snippet.type === 'image' ? '' : snippet.content}`.toLowerCase();
    return hay.includes(needle);
  });
});

const typeCounts = computed(() => ({
  text: snippets.value.filter((snippet) => snippet.type === 'text').length,
  code: snippets.value.filter((snippet) => snippet.type === 'code').length,
  link: snippets.value.filter((snippet) => snippet.type === 'link').length,
  image: snippets.value.filter((snippet) => snippet.type === 'image').length
}));

const draftSizeText = computed(() => {
  if (draftType.value === 'image') {
    const approxBytes = Math.floor((draftContent.value.length * 3) / 4);
    return formatBytes(Math.max(0, approxBytes));
  }
  return `${draftContent.value.trim().length} 字`;
});

watch(
  () => [filterType.value, snippets.value.length, typeCounts.value.text, typeCounts.value.code, typeCounts.value.link, typeCounts.value.image],
  () => {
    uiStore.setSecondaryNav({
      title: '剪贴板',
      activeKey: filterType.value,
      items: [
        { key: 'all', label: '全部', badge: String(snippets.value.length), to: '/snippets' },
        { key: 'text', label: '文本', badge: String(typeCounts.value.text), to: '/snippets?type=text' },
        { key: 'code', label: '代码', badge: String(typeCounts.value.code), to: '/snippets?type=code' },
        { key: 'link', label: '链接', badge: String(typeCounts.value.link), to: '/snippets?type=link' },
        { key: 'image', label: '图片', badge: String(typeCounts.value.image), to: '/snippets?type=image' }
      ]
    });
  },
  { immediate: true }
);

onMounted(async () => {
  await loadAll();
  if (initialFocus) {
    window.setTimeout(() => {
      highlightedId.value = null;
    }, 2400);
  }
  // 初始化瀑布流布局
  await nextTick();
  layoutMasonry();
  // 监听窗口大小变化
  window.addEventListener('resize', layoutMasonry);
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
  window.removeEventListener('resize', layoutMasonry);
});

async function loadAll() {
  loading.value = true;
  pageErrorMessage.value = '';
  try {
    const data = await snippetsApi.getAll({ type: 'all' });
    snippets.value = data.snippets;
    // 重新布局
    await nextTick();
    layoutMasonry();
  } catch (error) {
    pageErrorMessage.value = error instanceof Error ? error.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

function normalizeTypeFromContent(content: string): SnippetType {
  const value = content.trim();
  if (/^https?:\/\//i.test(value)) {
    return 'link';
  }
  if (/```|^\s*(const|let|var|function|import|export|class)\b|[{};]{2,}|<\/?[a-z][\s\S]*>/m.test(value)) {
    return 'code';
  }
  return 'text';
}

function toggleSnippetTools(snippetId: string) {
  if (expandedSnippets.value.has(snippetId)) {
    expandedSnippets.value.delete(snippetId);
  } else {
    expandedSnippets.value.add(snippetId);
  }
}

function buildSuggestedTitle(type: SnippetType, content: string) {
  if (type === 'image') {
    return '剪贴图片';
  }
  if (type === 'link') {
    try {
      return new URL(content).host.replace(/^www\./, '');
    } catch {
      return '剪贴链接';
    }
  }
  return content.trim().split(/\r?\n/)[0]?.slice(0, 24) || (type === 'code' ? '剪贴代码' : '剪贴文本');
}

function validateSnippet(type: SnippetType, content: string) {
  if (type === 'image') {
    if (!content) {
      return '请先读取或上传图片';
    }
    if (new TextEncoder().encode(content).byteLength > IMAGE_LIMIT_BYTES) {
      return '图片片段过大，请压缩后重试';
    }
    return '';
  }
  if (!content.trim()) {
    return '内容不能为空';
  }
  if (type === 'link' && !/^https?:\/\//i.test(content.trim())) {
    return '链接需以 http:// 或 https:// 开头';
  }
  return '';
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function compressImageDataUrl(dataUrl: string, maxBytes = IMAGE_LIMIT_BYTES) {
  if (new TextEncoder().encode(dataUrl).byteLength <= maxBytes) {
    return dataUrl;
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return dataUrl;
  }

  let scale = 1;
  let quality = 0.92;
  let best = dataUrl;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const next = canvas.toDataURL('image/jpeg', quality);
    best = next;
    if (new TextEncoder().encode(next).byteLength <= maxBytes) {
      return next;
    }
    scale *= 0.84;
    quality = Math.max(0.45, quality - 0.1);
  }

  return best;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function triggerImageUpload() {
  imageUploadInput.value?.click();
}

async function handleImageUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  try {
    const raw = await blobToDataUrl(file);
    const compressed = await compressImageDataUrl(raw);
    if (new TextEncoder().encode(compressed).byteLength > IMAGE_LIMIT_BYTES) {
      draftError.value = '图片过大，请选择更小图片';
      return;
    }
    draftType.value = 'image';
    draftContent.value = compressed;
    if (!draftTitle.value) {
      draftTitle.value = '剪贴图片';
    }
    draftError.value = '';
    uiStore.showToast('图片已载入');
  } catch (error) {
    draftError.value = error instanceof Error ? error.message : '图片处理失败';
  } finally {
    input.value = '';
  }
}

async function createSnippet() {
  const normalizedType = draftType.value === 'text' ? normalizeTypeFromContent(draftContent.value) : draftType.value;
  let normalizedContent = normalizedType === 'link' ? draftContent.value.trim() : draftContent.value;
  if (normalizedType === 'image' && normalizedContent) {
    normalizedContent = await compressImageDataUrl(normalizedContent);
  }
  const message = validateSnippet(normalizedType, normalizedContent);
  if (message) {
    draftError.value = message;
    return;
  }
  draftError.value = '';
  saving.value = true;
  try {
    const payload = {
      type: normalizedType,
      title: draftTitle.value.trim() || buildSuggestedTitle(normalizedType, normalizedContent),
      content: normalizedContent
    };
    const data = await snippetsApi.create(payload);
    snippets.value = [data.snippet, ...snippets.value];
    draftType.value = 'text';
    draftTitle.value = '';
    draftContent.value = '';
    uiStore.showToast('片段已创建');
    // 重新布局
    await nextTick();
    layoutMasonry();
  } catch (error) {
    draftError.value = error instanceof Error ? error.message : '创建失败';
  } finally {
    saving.value = false;
  }
}

async function readClipboardText() {
  clipboardBusy.value = 'text';
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      draftError.value = '剪贴板文本为空';
      return;
    }
    draftContent.value = text;
    draftType.value = normalizeTypeFromContent(text);
    if (!draftTitle.value) {
      draftTitle.value = buildSuggestedTitle(draftType.value, text);
    }
    draftError.value = '';
    uiStore.showToast('已读取剪贴板文本');
  } catch (error) {
    draftError.value = error instanceof Error ? error.message : '读取失败';
  } finally {
    clipboardBusy.value = 'idle';
  }
}

async function readClipboardImage() {
  clipboardBusy.value = 'image';
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (!imageType) {
        continue;
      }
      const blob = await item.getType(imageType);
      const dataUrl = await blobToDataUrl(blob);
      const compressed = await compressImageDataUrl(dataUrl);
      if (new TextEncoder().encode(compressed).byteLength > IMAGE_LIMIT_BYTES) {
        draftError.value = '剪贴板图片过大，请先压缩';
        return;
      }
      draftType.value = 'image';
      draftContent.value = compressed;
      if (!draftTitle.value) {
        draftTitle.value = '剪贴图片';
      }
      draftError.value = '';
      uiStore.showToast('已读取剪贴板图片');
      clipboardBusy.value = 'idle';
      return;
    }
    draftError.value = '剪贴板中没有图片';
  } catch (error) {
    draftError.value = error instanceof Error ? error.message : '读取图片失败';
  } finally {
    clipboardBusy.value = 'idle';
  }
}

async function togglePin(snippet: SnippetRecord) {
  try {
    const data = await snippetsApi.update(snippet.id, { isPinned: !snippet.isPinned });
    snippets.value = snippets.value.map((entry) => (entry.id === data.snippet.id ? data.snippet : entry));
    snippets.value.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
    uiStore.showToast(data.snippet.isPinned ? '已置顶' : '已取消置顶');
    // 重新布局
    await nextTick();
    layoutMasonry();
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '操作失败');
  }
}

async function toggleLoginMap(snippet: SnippetRecord) {
  try {
    // 检查已映射的数量
    const mappedCount = snippets.value.filter(s => s.isLoginMapped).length;
    
    if (!snippet.isLoginMapped && mappedCount >= 9) {
      uiStore.showToast('最多只能映射9个片段到登录页');
      return;
    }
    
    const data = await snippetsApi.update(snippet.id, { isLoginMapped: !snippet.isLoginMapped });
    snippets.value = snippets.value.map((entry) => (entry.id === data.snippet.id ? data.snippet : entry));
    uiStore.showToast(data.snippet.isLoginMapped ? '已映射到登录页' : '已取消映射');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '操作失败');
  }
}

function openEditDialog(snippet: SnippetRecord) {
  editingSnippet.value = snippet;
  editType.value = snippet.type;
  editTitle.value = snippet.title;
  editContent.value = snippet.content;
  editErrorMessage.value = '';
  editDialogOpen.value = true;
}

function closeEditDialog() {
  editDialogOpen.value = false;
  editErrorMessage.value = '';
}

async function saveEdit() {
  if (!editingSnippet.value) {
    return;
  }
  let nextContent = editType.value === 'link' ? editContent.value.trim() : editContent.value;
  if (editType.value === 'image' && nextContent) {
    nextContent = await compressImageDataUrl(nextContent);
  }
  const message = validateSnippet(editType.value, nextContent);
  if (message) {
    editErrorMessage.value = message;
    return;
  }
  saving.value = true;
  editErrorMessage.value = '';
  try {
    const data = await snippetsApi.update(editingSnippet.value.id, {
      type: editType.value,
      title: editTitle.value.trim() || buildSuggestedTitle(editType.value, nextContent),
      content: nextContent
    });
    snippets.value = snippets.value.map((entry) => (entry.id === data.snippet.id ? data.snippet : entry));
    snippets.value.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
    editDialogOpen.value = false;
    uiStore.showToast('已保存');
    // 重新布局
    await nextTick();
    layoutMasonry();
  } catch (error) {
    editErrorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

function buildCodePreview(content: string) {
  const lines = content.split(/\r?\n/);
  const preview = lines.slice(0, 6).join('\n');
  if (lines.length > 6 || preview.length < content.length) {
    return `${preview}\n...`;
  }
  return preview;
}

function snippetTypeClass(type: SnippetType) {
  return `snippet-card--${type}`;
}

async function confirmDelete() {
  if (!deleteTarget.value) {
    return;
  }
  try {
    await snippetsApi.delete(deleteTarget.value.id);
    snippets.value = snippets.value.filter((entry) => entry.id !== deleteTarget.value?.id);
    deleteTarget.value = null;
    uiStore.showToast('已删除');
    // 重新布局
    await nextTick();
    layoutMasonry();
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除失败');
  }
}

async function copySnippet(snippet: SnippetRecord) {
  try {
    if (snippet.type === 'image') {
      const response = await fetch(snippet.content);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      uiStore.showToast('图片已复制');
      return;
    }
    await navigator.clipboard.writeText(snippet.content);
    uiStore.showToast('已复制');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '复制失败');
  }
}

// 瀑布流布局函数
function layoutMasonry() {
  if (!filtered.value.length) {
    leftColumn.value = [];
    rightColumn.value = [];
    return;
  }

  // 估算每个剪贴板的高度
  const estimateHeight = (snippet: SnippetRecord): number => {
    // 基础高度：标题 + 操作按钮 + padding
    let height = 80;
    
    if (snippet.type === 'image') {
      // 图片预览高度
      height += 220;
    } else if (snippet.type === 'code') {
      // 代码块高度（最多6行）
      const lines = Math.min(6, snippet.content.split('\n').length);
      height += lines * 22 + 24; // 行高 + padding
    } else {
      // 文本高度（最多180px）
      const textLength = snippet.content.length;
      const estimatedLines = Math.ceil(textLength / 50); // 假设每行50字符
      height += Math.min(180, estimatedLines * 22 + 24);
    }
    
    return height;
  };

  const left: SnippetRecord[] = [];
  const right: SnippetRecord[] = [];
  let leftHeight = 0;
  let rightHeight = 0;

  // 左列第一个位置是快速收集表单，估算其高度
  const quickCollectHeight = 420; // 快速收集表单的估算高度（增加了 textarea 高度）
  leftHeight = quickCollectHeight;

  // 按顺序遍历所有剪贴板，放到高度更低的那一列
  for (const snippet of filtered.value) {
    const height = estimateHeight(snippet);
    
    if (leftHeight <= rightHeight) {
      left.push(snippet);
      leftHeight += height + 12; // 12px gap
    } else {
      right.push(snippet);
      rightHeight += height + 12;
    }
  }

  leftColumn.value = left;
  rightColumn.value = right;
}

// 监听筛选变化，重新布局
watch([searchQuery, filterType], async () => {
  await nextTick();
  layoutMasonry();
});
</script>

<template>
  <div class="grid gap-4">
    <!-- 剪贴板列表 -->
    <section class="card">
      <div class="mb-3 snippet-header">
        <div class="snippet-title-section">
          <div class="snippet-title-row">
            <button type="button" class="mobile-menu-btn" @click="uiStore.openMobileNav">
              <Icon icon="carbon:menu" />
            </button>
            <div>
              <h3 class="text-lg font-semibold text-gray-900">剪贴板</h3>
              <p class="text-sm text-gray-500">快速收集文本、代码、链接和图片</p>
            </div>
          </div>
        </div>
        
        <!-- 搜索筛选 -->
        <div class="snippet-search-section">
          <div class="snippet-search-row">
            <ElInput v-model="searchQuery" size="small" clearable placeholder="按标题或内容筛选..." class="snippet-search-input" />
            <ElTag size="small">{{ filtered.length }} 条</ElTag>
          </div>
          
          <!-- 类型筛选标签页 -->
          <div class="snippet-type-tabs">
            <button
              v-for="option in typeOptions"
              :key="option.key"
              type="button"
              class="snippet-type-tab"
              :class="{ active: filterType === option.key }"
              @click="filterType = filterType === option.key ? 'all' : option.key"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        加载中...
      </div>
      <ElAlert v-else-if="pageErrorMessage" :closable="false" show-icon type="error" :title="pageErrorMessage" />
      <div v-else-if="!filtered.length" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        暂无内容
      </div>
      <div v-else class="snippet-layout">
        <!-- 瀑布流布局：左右两列 -->
        <div class="masonry-container">
          <!-- 左列 -->
          <div class="masonry-column">
            <!-- 快速收集表单固定在左列顶部 -->
            <div class="quick-collect-card content-card">
              <div class="mb-2 flex items-center justify-between">
                <h4 class="text-sm font-semibold text-gray-900">快速收集</h4>
                <ElTag size="small" type="info">{{ draftSizeText }}</ElTag>
              </div>

              <div class="grid gap-2">
                <label class="text-xs text-gray-600">类型</label>
                <ElSelect v-model="draftType" size="small">
                  <ElOption v-for="option in typeOptions" :key="option.key" :label="option.label" :value="option.key" />
                </ElSelect>
              </div>

              <div class="mt-2 grid gap-2">
                <label class="text-xs text-gray-600">标题</label>
                <ElInput v-model="draftTitle" size="small" placeholder="可选，留空自动生成" />
              </div>

              <div class="mt-2 grid gap-2">
                <label class="text-xs text-gray-600">内容</label>
                <ElInput v-if="draftType !== 'image'" v-model="draftContent" size="small" type="textarea" :rows="8" placeholder="输入内容" />
                <div v-else class="rounded-lg border border-gray-200 bg-white p-2 min-h-[200px] flex items-center justify-center">
                  <div v-if="draftContent" class="snippet-image-preview-small">
                    <img :src="draftContent" alt="draft" />
                  </div>
                  <p v-else class="text-xs text-gray-500">未选择图片</p>
                </div>
              </div>

              <div class="mt-2 snippet-actions-row">
                <div class="snippet-actions-left">
                  <UiButton size="small" :disabled="clipboardBusy !== 'idle'" @click="readClipboardText">
                    <Icon icon="carbon:paste" class="text-sm" />
                  </UiButton>
                  <UiButton size="small" :disabled="clipboardBusy !== 'idle'" @click="readClipboardImage">
                    <Icon icon="carbon:image-search" class="text-sm" />
                  </UiButton>
                  <UiButton size="small" @click="triggerImageUpload">
                    <Icon icon="carbon:upload" class="text-sm" />
                  </UiButton>
                </div>
                <UiButton size="small" type="primary" :loading="saving" :disabled="saving" @click="createSnippet">
                  <Icon icon="carbon:save" class="mr-1 text-sm" />
                  保存
                </UiButton>
              </div>

              <input ref="imageUploadInput" type="file" accept="image/*" class="hidden" @change="handleImageUpload" />
              <ElAlert v-if="draftError" class="mt-2" :closable="false" show-icon type="error" :title="draftError" />
            </div>

            <!-- 左列剪贴板 -->
            <article
              v-for="snippet in leftColumn"
              :key="snippet.id"
              class="content-card"
              :class="[snippetTypeClass(snippet.type), { 'snippet-card-highlight': highlightedId === snippet.id }]"
              :data-snippet-id="snippet.id"
            >
              <div class="mb-2 snippet-card-header">
                <div class="snippet-card-title">
                  <strong class="block truncate text-sm text-gray-900">{{ snippet.title || '未命名片段' }}</strong>
                  <p class="truncate text-xs text-gray-500">{{ snippet.type }} · {{ formatDateTime(snippet.updatedAt) }}</p>
                </div>
                <div class="snippet-tools" :class="{ expanded: expandedSnippets.has(snippet.id) }">
                  <UiButton size="small" text @click="togglePin(snippet)">
                    <Icon :icon="snippet.isPinned ? 'carbon:star-filled' : 'carbon:star'" />
                  </UiButton>
                  <UiButton size="small" text @click="toggleLoginMap(snippet)" :title="snippet.isLoginMapped ? '取消映射到登录页' : '映射到登录页'">
                    <Icon :icon="snippet.isLoginMapped ? 'carbon:location-filled' : 'carbon:location'" />
                  </UiButton>
                  <UiButton size="small" text @click="copySnippet(snippet)">
                    <Icon icon="carbon:copy" />
                  </UiButton>
                  <UiButton size="small" text @click="openEditDialog(snippet)">
                    <Icon icon="carbon:edit" />
                  </UiButton>
                  <UiButton size="small" text type="danger" @click="deleteTarget = snippet">
                    <Icon icon="carbon:trash-can" />
                  </UiButton>
                </div>
                <button 
                  type="button"
                  class="snippet-tools-toggle"
                  @click="toggleSnippetTools(snippet.id)"
                  :aria-label="expandedSnippets.has(snippet.id) ? '收起工具' : '展开工具'"
                >
                  <Icon :icon="expandedSnippets.has(snippet.id) ? 'carbon:chevron-left' : 'carbon:chevron-right'" />
                </button>
              </div>

              <div v-if="snippet.type === 'image'" class="snippet-image-preview">
                <img :src="snippet.content" alt="snippet" />
              </div>
              <pre v-else-if="snippet.type === 'code'" class="code-block snippet-code-preview">{{ buildCodePreview(snippet.content) }}</pre>
              <pre v-else class="snippet-text-preview">{{ snippet.content }}</pre>
            </article>
          </div>

          <!-- 右列剪贴板 -->
          <div class="masonry-column">
            <article
              v-for="snippet in rightColumn"
              :key="snippet.id"
              class="content-card"
              :class="[snippetTypeClass(snippet.type), { 'snippet-card-highlight': highlightedId === snippet.id }]"
              :data-snippet-id="snippet.id"
            >
              <div class="mb-2 snippet-card-header">
                <div class="snippet-card-title">
                  <strong class="block truncate text-sm text-gray-900">{{ snippet.title || '未命名片段' }}</strong>
                  <p class="truncate text-xs text-gray-500">{{ snippet.type }} · {{ formatDateTime(snippet.updatedAt) }}</p>
                </div>
                <div class="snippet-tools" :class="{ expanded: expandedSnippets.has(snippet.id) }">
                  <UiButton size="small" text @click="togglePin(snippet)">
                    <Icon :icon="snippet.isPinned ? 'carbon:star-filled' : 'carbon:star'" />
                  </UiButton>
                  <UiButton size="small" text @click="toggleLoginMap(snippet)" :title="snippet.isLoginMapped ? '取消映射到登录页' : '映射到登录页'">
                    <Icon :icon="snippet.isLoginMapped ? 'carbon:location-filled' : 'carbon:location'" />
                  </UiButton>
                  <UiButton size="small" text @click="copySnippet(snippet)">
                    <Icon icon="carbon:copy" />
                  </UiButton>
                  <UiButton size="small" text @click="openEditDialog(snippet)">
                    <Icon icon="carbon:edit" />
                  </UiButton>
                  <UiButton size="small" text type="danger" @click="deleteTarget = snippet">
                    <Icon icon="carbon:trash-can" />
                  </UiButton>
                </div>
                <button 
                  type="button"
                  class="snippet-tools-toggle"
                  @click="toggleSnippetTools(snippet.id)"
                  :aria-label="expandedSnippets.has(snippet.id) ? '收起工具' : '展开工具'"
                >
                  <Icon :icon="expandedSnippets.has(snippet.id) ? 'carbon:chevron-left' : 'carbon:chevron-right'" />
                </button>
              </div>

              <div v-if="snippet.type === 'image'" class="snippet-image-preview">
                <img :src="snippet.content" alt="snippet" />
              </div>
              <pre v-else-if="snippet.type === 'code'" class="code-block snippet-code-preview">{{ buildCodePreview(snippet.content) }}</pre>
              <pre v-else class="snippet-text-preview">{{ snippet.content }}</pre>
            </article>
          </div>
        </div>
      </div>
    </section>

    <ElDialog
      v-model="editDialogOpen"
      title="编辑片段"
      width="680px"
      :close-on-click-modal="false"
      align-center
      @close="closeEditDialog"
    >
      <div class="grid gap-3">
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">类型</label>
          <ElSelect v-model="editType" size="small">
            <ElOption v-for="option in typeOptions" :key="option.key" :label="option.label" :value="option.key" />
          </ElSelect>
        </div>
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">标题</label>
          <ElInput v-model="editTitle" size="small" />
        </div>
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">内容</label>
          <ElInput v-if="editType !== 'image'" v-model="editContent" size="small" type="textarea" :rows="8" />
          <div v-else class="rounded-xl border border-gray-200 bg-white p-3">
            <div v-if="editContent" class="snippet-image-preview">
              <img :src="editContent" alt="snippet-preview" />
            </div>
            <p v-else class="text-sm text-gray-500">暂无图片内容</p>
          </div>
        </div>
      </div>
      <ElAlert v-if="editErrorMessage" class="mt-3" :closable="false" show-icon type="error" :title="editErrorMessage" />
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton size="small" @click="closeEditDialog">取消</UiButton>
          <UiButton size="small" type="primary" :loading="saving" :disabled="saving" @click="saveEdit">保存</UiButton>
        </div>
      </template>
    </ElDialog>

    <ConfirmModal
      :open="Boolean(deleteTarget)"
      title="删除片段"
      :message="`确认删除「${deleteTarget?.title || '未命名片段'}」？`"
      confirm-text="删除"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
/* 统一筛选栏组件高度 */
:deep(.el-tag--small) {
  height: 36px;
  line-height: 34px;
  padding: 0 12px;
}

/* 自定义分段选择器 */
.segmented-control {
  display: inline-flex;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}

.segmented-item {
  height: 32px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.segmented-item:hover {
  color: #111827;
  background: rgba(0, 0, 0, 0.03);
}

.segmented-item-active {
  background: #fff;
  color: #111827;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* 瀑布流容器 */
.masonry-container {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  align-items: start;
}

/* 瀑布流列 */
.masonry-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 内容卡片基础样式 */
.content-card {
  background: #ffffff !important;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s ease;
}

.content-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

/* 快速收集卡片 */
.quick-collect-card {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%) !important;
  border: 1px solid rgba(139, 92, 246, 0.2);
}

/* 桌面端默认样式 */
.snippet-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.snippet-search-section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.snippet-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.snippet-search-input {
  width: 200px;
}

.snippet-title-row {
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
  position: relative;
  z-index: 1;
}

.mobile-menu-btn > * {
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-menu-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.snippet-type-tabs {
  display: flex;
  gap: 4px;
}

.snippet-type-tab {
  padding: 6px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #6b7280;
  font-size: 14px;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;
}

.snippet-type-tab:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.snippet-type-tab.active {
  background: #111111;
  color: #fff;
  border-color: #111111;
}

.snippet-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.snippet-actions-left {
  display: flex;
  gap: 4px;
}

/* 剪贴板卡片头部 */
.snippet-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.snippet-card-title {
  flex: 1;
  min-width: 0;
}

/* 折叠按钮 - 桌面端隐藏 */
.snippet-tools-toggle {
  display: none;
}

/* 工具栏 - 桌面端始终显示 */
.snippet-tools {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.snippet-card-highlight {
  box-shadow: 0 0 0 3px rgba(123, 68, 26, 0.16);
}

.snippet-card--text {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(52, 211, 153, 0.12) 100%);
  border-left: 3px solid #10b981;
}

.snippet-card--code {
  background: linear-gradient(135deg, rgba(71, 85, 105, 0.12) 0%, rgba(100, 116, 139, 0.12) 100%);
  border-left: 3px solid #475569;
}

.snippet-card--link {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(96, 165, 250, 0.12) 100%);
  border-left: 3px solid #3b82f6;
}

.snippet-card--image {
  background: linear-gradient(135deg, rgba(236, 72, 153, 0.12) 0%, rgba(244, 114, 182, 0.12) 100%);
  border-left: 3px solid #ec4899;
}

.snippet-code-preview,
.snippet-text-preview {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 12px;
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  max-height: 180px;
  overflow-y: auto;
}

.snippet-code-preview {
  margin: 0;
  border: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.snippet-text-preview {
  border: 1px solid #e5e7eb;
  background: #fff;
}

.snippet-image-preview {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  display: flex;
  justify-content: center;
  padding: 12px;
}

.snippet-image-preview img {
  max-height: 220px;
  max-width: 100%;
  border-radius: 8px;
}

.snippet-image-preview-small {
  display: flex;
  justify-content: center;
  align-items: center;
}

.snippet-image-preview-small img {
  max-height: 120px;
  max-width: 100%;
  border-radius: 6px;
}

/* 工具按钮样式优化 */
.snippet-tools {
  gap: 1px;
}

.snippet-tools :deep(.el-button),
.snippet-tools :deep(.el-button::before),
.snippet-tools :deep(.el-button::after) {
  padding: 4px;
  min-width: 28px;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition: none !important;
  transform: none !important;
  box-shadow: none !important;
}

.snippet-tools :deep(.el-button:hover),
.snippet-tools :deep(.el-button:hover::before),
.snippet-tools :deep(.el-button:hover::after) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition: none !important;
  transform: none !important;
  box-shadow: none !important;
}

.snippet-tools :deep(.el-button:active),
.snippet-tools :deep(.el-button:active::before),
.snippet-tools :deep(.el-button:active::after) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition: none !important;
  transform: none !important;
  box-shadow: none !important;
}

.snippet-tools :deep(.el-button:focus),
.snippet-tools :deep(.el-button:focus::before),
.snippet-tools :deep(.el-button:focus::after) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition: none !important;
  transform: none !important;
  box-shadow: none !important;
  outline: none !important;
}

/* 禁用图标的所有动画效果 */
.snippet-tools :deep(.iconify),
.snippet-tools :deep(svg) {
  transition: none !important;
  transform: none !important;
  animation: none !important;
}

/* 文本类型卡片的按钮悬停效果 */
.snippet-card--text .snippet-tools :deep(.el-button.is-text:hover) {
  background-color: rgba(16, 185, 129, 0.15);
}

/* 代码类型卡片的按钮悬停效果 */
.snippet-card--code .snippet-tools :deep(.el-button.is-text:hover) {
  background-color: rgba(71, 85, 105, 0.15);
}

/* 链接类型卡片的按钮悬停效果 */
.snippet-card--link .snippet-tools :deep(.el-button.is-text:hover) {
  background-color: rgba(59, 130, 246, 0.15);
}

/* 图片类型卡片的按钮悬停效果 */
.snippet-card--image .snippet-tools :deep(.el-button.is-text:hover) {
  background-color: rgba(236, 72, 153, 0.15);
}

/* 删除按钮保持红色悬停效果 */
.snippet-tools :deep(.el-button.is-text.el-button--danger:hover) {
  background-color: rgba(239, 68, 68, 0.1) !important;
  color: #ef4444;
  backdrop-filter: none !important;
  box-shadow: none !important;
}

@media (max-width: 1024px) {
  .masonry-container {
    grid-template-columns: 1fr !important;
  }

  /* 移动端：使用flexbox和order重排 */
  .snippet-header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .snippet-title-section {
    order: 1;
  }

  .quick-collect-card {
    order: 2;
  }

  .snippet-search-section {
    order: 3;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    margin-top: 12px;
  }

  /* 搜索框和数量一行 */
  .snippet-search-row {
    width: 100%;
  }

  .snippet-search-input {
    flex: 1;
    width: auto;
  }

  /* 类型筛选标签页 */
  .snippet-type-tabs {
    justify-content: center;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
    gap: 6px;
  }

  .snippet-type-tab {
    flex-shrink: 0;
    padding: 6px 16px;
    font-size: 14px;
    border-radius: 8px;
  }

  /* 快速收集按钮行 */
  .snippet-actions-row {
    gap: 6px;
  }

  .snippet-actions-left {
    gap: 4px;
  }

  .mobile-menu-btn {
    display: flex;
  }

  .snippet-layout {
    width: 100%;
    max-width: 100%;
    overflow: hidden;
  }

  .quick-collect-card {
    width: 100%;
    overflow: hidden;
  }

  /* 强制文本换行 */
  .content-card,
  .snippet-card {
    overflow: hidden;
  }

  .content-card *,
  .snippet-card * {
    word-break: break-word;
    overflow-wrap: break-word;
  }

  /* 代码块特殊处理 */
  .snippet-code-preview,
  .code-block {
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
  }

  /* 图片预览 */
  .snippet-image-preview,
  .snippet-image-preview-small {
    max-width: 100%;
    overflow: hidden;
  }

  .snippet-image-preview img,
  .snippet-image-preview-small img {
    max-width: 100%;
    height: auto;
  }
}

@media (max-width: 640px) {
  .snippet-card {
    padding: 12px;
  }

  /* 移动端：卡片头部布局 */
  .snippet-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  /* 标题区域：可被挤压 */
  .snippet-card-title {
    flex: 1;
    min-width: 0;
    transition: all 200ms ease;
  }

  /* 折叠按钮 */
  .snippet-tools-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    color: #6b7280;
    cursor: pointer;
    transition: all 150ms ease;
    flex-shrink: 0;
    font-size: 16px;
    position: relative;
    z-index: 1;
  }

  .snippet-tools-toggle > * {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .snippet-tools-toggle:hover {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  /* 工具栏：默认宽度为0 */
  .snippet-tools {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 0;
    overflow: hidden;
    opacity: 0;
    transition: all 200ms ease;
    flex-shrink: 0;
  }

  /* 工具栏展开：占据空间 */
  .snippet-tools.expanded {
    width: auto;
    opacity: 1;
  }

  /* 类型标签更紧凑 */
  .snippet-type-tab {
    padding: 5px 12px;
    font-size: 13px;
  }
}
</style>
