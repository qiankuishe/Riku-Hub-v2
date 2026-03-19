<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElAlert, ElButton, ElDialog, ElInput, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTag } from 'element-plus';
import { Icon } from '@iconify/vue';
import type { SnippetRecord, SnippetType } from '../../api';
import { snippetsApi } from '../../api';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';
import ConfirmModal from '../shared/ConfirmModal.vue';

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
});

onUnmounted(() => {
  uiStore.clearSecondaryNav();
});

async function loadAll() {
  loading.value = true;
  pageErrorMessage.value = '';
  try {
    const data = await snippetsApi.getAll({ type: 'all' });
    snippets.value = data.snippets;
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
</script>

<template>
  <div class="grid gap-4">
    <section class="card">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">剪贴板</h2>
          <p class="text-sm text-gray-500">快速收集文本、代码、链接和图片。</p>
        </div>
        <ElButton :loading="loading" @click="loadAll">
          <Icon icon="carbon:renew" class="mr-1" />
          {{ loading ? '刷新中...' : '刷新' }}
        </ElButton>
      </div>

      <div class="grid gap-3">
        <ElRadioGroup v-model="filterType" size="small">
          <ElRadioButton label="all">全部</ElRadioButton>
          <ElRadioButton v-for="option in typeOptions" :key="option.key" :label="option.key">
            {{ option.label }}
          </ElRadioButton>
        </ElRadioGroup>

        <ElInput v-model="searchQuery" clearable placeholder="按标题或内容筛选..." />
      </div>
    </section>

    <section class="card">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900">快速收集</h3>
        <ElTag size="small" type="info">当前内容大小：{{ draftSizeText }}</ElTag>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">类型</label>
          <ElSelect v-model="draftType">
            <ElOption v-for="option in typeOptions" :key="option.key" :label="option.label" :value="option.key" />
          </ElSelect>
        </div>
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">标题</label>
          <ElInput v-model="draftTitle" placeholder="可选，留空自动生成" />
        </div>
      </div>

      <div class="mt-3 grid gap-2">
        <label class="text-sm text-gray-600">内容</label>
        <ElInput v-if="draftType !== 'image'" v-model="draftContent" type="textarea" :rows="7" placeholder="输入内容" />
        <div v-else class="rounded-xl border border-gray-200 bg-white p-3">
          <div v-if="draftContent" class="snippet-image-preview">
            <img :src="draftContent" alt="draft" />
          </div>
          <p v-else class="text-sm text-gray-500">未选择图片，可读取剪贴板或上传图片。</p>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <ElButton :disabled="clipboardBusy !== 'idle'" @click="readClipboardText">
          <Icon icon="carbon:paste" class="mr-1" />
          {{ clipboardBusy === 'text' ? '读取中...' : '读取文本' }}
        </ElButton>
        <ElButton :disabled="clipboardBusy !== 'idle'" @click="readClipboardImage">
          <Icon icon="carbon:image-search" class="mr-1" />
          {{ clipboardBusy === 'image' ? '读取中...' : '读取图片' }}
        </ElButton>
        <ElButton @click="triggerImageUpload">
          <Icon icon="carbon:upload" class="mr-1" />
          上传图片
        </ElButton>
        <ElButton type="primary" :loading="saving" :disabled="saving" @click="createSnippet">
          <Icon icon="carbon:save" class="mr-1" />
          保存片段
        </ElButton>
      </div>

      <input ref="imageUploadInput" type="file" accept="image/*" class="hidden" @change="handleImageUpload" />
      <ElAlert v-if="draftError" class="mt-3" :closable="false" show-icon type="error" :title="draftError" />
    </section>

    <section class="card">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-900">结果列表</h3>
        <ElTag size="small">{{ filtered.length }} 条</ElTag>
      </div>

      <div v-if="loading" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        加载中...
      </div>
      <ElAlert v-else-if="pageErrorMessage" :closable="false" show-icon type="error" :title="pageErrorMessage" />
      <div v-else-if="!filtered.length" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        暂无内容
      </div>
      <div v-else class="snippet-cards">
        <article
          v-for="snippet in filtered"
          :key="snippet.id"
          class="content-card"
          :class="[snippetTypeClass(snippet.type), { 'snippet-card-highlight': highlightedId === snippet.id }]"
          :data-snippet-id="snippet.id"
        >
          <div class="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <strong class="block truncate text-sm text-gray-900">{{ snippet.title || '未命名片段' }}</strong>
              <p class="text-xs text-gray-500">{{ snippet.type }} · {{ formatDateTime(snippet.updatedAt) }}</p>
            </div>
            <div class="flex flex-wrap gap-1">
              <ElButton size="small" text @click="togglePin(snippet)">
                <Icon :icon="snippet.isPinned ? 'carbon:star-filled' : 'carbon:star'" />
              </ElButton>
              <ElButton size="small" text @click="toggleLoginMap(snippet)" :title="snippet.isLoginMapped ? '取消映射到登录页' : '映射到登录页'">
                <Icon :icon="snippet.isLoginMapped ? 'carbon:location-filled' : 'carbon:location'" />
              </ElButton>
              <ElButton size="small" text @click="copySnippet(snippet)">
                <Icon icon="carbon:copy" />
              </ElButton>
              <ElButton size="small" text @click="openEditDialog(snippet)">
                <Icon icon="carbon:edit" />
              </ElButton>
              <ElButton size="small" text type="danger" @click="deleteTarget = snippet">
                <Icon icon="carbon:trash-can" />
              </ElButton>
            </div>
          </div>

          <div v-if="snippet.type === 'image'" class="snippet-image-preview">
            <img :src="snippet.content" alt="snippet" />
          </div>
          <pre v-else-if="snippet.type === 'code'" class="code-block snippet-code-preview">{{ buildCodePreview(snippet.content) }}</pre>
          <pre v-else class="snippet-text-preview">{{ snippet.content }}</pre>
        </article>
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
          <ElSelect v-model="editType">
            <ElOption v-for="option in typeOptions" :key="option.key" :label="option.label" :value="option.key" />
          </ElSelect>
        </div>
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">标题</label>
          <ElInput v-model="editTitle" />
        </div>
        <div class="grid gap-2">
          <label class="text-sm text-gray-600">内容</label>
          <ElInput v-if="editType !== 'image'" v-model="editContent" type="textarea" :rows="8" />
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
          <ElButton @click="closeEditDialog">取消</ElButton>
          <ElButton type="primary" :loading="saving" :disabled="saving" @click="saveEdit">保存</ElButton>
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
.snippet-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.snippet-card-highlight {
  box-shadow: 0 0 0 3px rgba(123, 68, 26, 0.16);
}

.snippet-card--text {
  background: rgba(110, 110, 115, 0.04);
}

.snippet-card--code {
  background: rgba(67, 93, 196, 0.05);
}

.snippet-card--link {
  background: rgba(24, 143, 105, 0.06);
}

.snippet-card--image {
  background: rgba(191, 110, 33, 0.06);
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

@media (max-width: 1024px) {
  .snippet-cards {
    grid-template-columns: 1fr;
  }
}
</style>
