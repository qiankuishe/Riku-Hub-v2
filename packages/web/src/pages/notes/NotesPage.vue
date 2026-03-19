<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElAlert, ElButton, ElInput, ElRadioButton, ElRadioGroup, ElTag } from 'element-plus';
import { Icon } from '@iconify/vue';
import type { NoteRecord } from '../../api';
import { notesApi } from '../../api';
import ConfirmModal from '../shared/ConfirmModal.vue';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';

type ViewMode = 'write' | 'preview' | 'split';

const uiStore = useUiStore();
const initialFocusId = new URLSearchParams(window.location.search).get('focus');

const notes = ref<NoteRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const searchQuery = ref('');
const selectedNoteId = ref<string | null>(null);
const editTitle = ref('');
const editContent = ref('');
const viewMode = ref<ViewMode>('write');
const renderedPreview = ref('');
const deleteTarget = ref<NoteRecord | null>(null);
const highlightedId = ref<string | null>(null);
const NOTE_TITLE_MAX_UNITS_ZH = 28;
const NOTE_TITLE_MAX_UNITS_EN = 26;
const NOTE_TITLE_MAX_UNITS_MIXED = 27;
const NOTE_EXCERPT_MAX_UNITS_ZH = 32;
const NOTE_EXCERPT_MAX_UNITS_EN = 32;
const NOTE_EXCERPT_MAX_UNITS_MIXED = 32;
const ELLIPSIS_MARK = '···';

let saveTimer = 0;
let previewRunId = 0;
let hydrating = false;
let markdownRenderer: ((value: string) => Promise<string>) | null = null;

const filtered = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  if (!needle) {
    return notes.value;
  }
  return notes.value.filter((note) => note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle));
});
const pinnedNotes = computed(() => filtered.value.filter((note) => note.isPinned));
const recentNotes = computed(() => filtered.value.filter((note) => !note.isPinned));
const selectedNote = computed(() => notes.value.find((note) => note.id === selectedNoteId.value) ?? null);
const characterCount = computed(() => editContent.value.trim().length);
const lineCount = computed(() => (editContent.value ? editContent.value.split(/\r?\n/).length : 0));

watch(selectedNote, (note) => {
  hydrating = true;
  editTitle.value = note?.title ?? '';
  editContent.value = note?.content ?? '';
  nextTick(() => {
    hydrating = false;
  });
});

watch([editTitle, editContent], () => {
  if (hydrating || !selectedNote.value) {
    return;
  }
  queueSave();
});

watch(
  () => [viewMode.value, editContent.value],
  async ([mode, content]) => {
    if (mode === 'write') {
      return;
    }
    const runId = ++previewRunId;
    const html = await renderMarkdown(content);
    if (runId !== previewRunId) {
      return;
    }
    renderedPreview.value = html;
  },
  { immediate: true }
);

onMounted(async () => {
  uiStore.clearSecondaryNav();
  await loadAll();
  if (initialFocusId && notes.value.some((note) => note.id === initialFocusId)) {
    selectedNoteId.value = initialFocusId;
    highlightedId.value = initialFocusId;
    window.setTimeout(() => {
      highlightedId.value = null;
    }, 2000);
  }
});

onUnmounted(() => {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
});

async function loadAll() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await notesApi.getAll();
    notes.value = data.notes;
    if (!selectedNoteId.value && notes.value.length) {
      selectedNoteId.value = notes.value[0].id;
    }
    if (selectedNoteId.value && !notes.value.some((note) => note.id === selectedNoteId.value)) {
      selectedNoteId.value = notes.value[0]?.id ?? null;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

async function createNote() {
  saving.value = true;
  try {
    const data = await notesApi.create({ title: '新笔记', content: '' });
    notes.value = [data.note, ...notes.value];
    selectedNoteId.value = data.note.id;
    viewMode.value = 'write';
    uiStore.showToast('已创建笔记');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

async function saveNow() {
  if (!selectedNote.value) {
    return;
  }
  saving.value = true;
  try {
    const data = await notesApi.update(selectedNote.value.id, {
      title: editTitle.value.trim() || '无标题',
      content: editContent.value
    });
    notes.value = notes.value.map((note) => (note.id === data.note.id ? data.note : note));
    notes.value.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    saving.value = false;
  }
}

function queueSave() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    void saveNow();
  }, 600);
}

async function togglePin() {
  if (!selectedNote.value) {
    return;
  }
  try {
    const data = await notesApi.update(selectedNote.value.id, {
      isPinned: !selectedNote.value.isPinned
    });
    notes.value = notes.value.map((note) => (note.id === data.note.id ? data.note : note));
    notes.value.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
    uiStore.showToast(data.note.isPinned ? '已置顶' : '已取消置顶');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '操作失败');
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) {
    return;
  }
  try {
    await notesApi.delete(deleteTarget.value.id);
    notes.value = notes.value.filter((note) => note.id !== deleteTarget.value?.id);
    if (selectedNoteId.value === deleteTarget.value.id) {
      selectedNoteId.value = notes.value[0]?.id ?? null;
    }
    deleteTarget.value = null;
    uiStore.showToast('已删除');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '删除失败');
  }
}

async function renderMarkdown(content: string) {
  if (!markdownRenderer) {
    markdownRenderer = async (value: string) => {
      const [{ marked }, purifier] = await Promise.all([import('marked'), import('dompurify')]);
      marked.setOptions({ breaks: true, gfm: true });
      return purifier.default.sanitize(marked.parse(value) as string);
    };
  }
  return markdownRenderer(content);
}

function noteExcerpt(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '空白笔记';
  }
  return truncateByVisualUnits(normalized, getExcerptMaxUnits(normalized));
}

function getNoteDisplayTitle(title: string) {
  const normalized = title?.trim() || '无标题';
  return truncateByVisualUnits(normalized, getTitleMaxUnits(normalized));
}

function isHanCharacter(char: string) {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(char);
}

function getTextMode(value: string): 'zh' | 'en' | 'mixed' {
  let hanCount = 0;
  let latinCount = 0;
  for (const char of value) {
    if (/\s/.test(char)) {
      continue;
    }
    if (isHanCharacter(char)) {
      hanCount += 1;
      continue;
    }
    if (/[A-Za-z0-9]/.test(char)) {
      latinCount += 1;
    }
  }
  if (hanCount > 0 && latinCount === 0) {
    return 'zh';
  }
  if (latinCount > 0 && hanCount === 0) {
    return 'en';
  }
  return 'mixed';
}

function getTitleMaxUnits(value: string) {
  const mode = getTextMode(value);
  if (mode === 'zh') {
    return NOTE_TITLE_MAX_UNITS_ZH;
  }
  if (mode === 'en') {
    return NOTE_TITLE_MAX_UNITS_EN;
  }
  return NOTE_TITLE_MAX_UNITS_MIXED;
}

function getExcerptMaxUnits(value: string) {
  const mode = getTextMode(value);
  if (mode === 'zh') {
    return NOTE_EXCERPT_MAX_UNITS_ZH;
  }
  if (mode === 'en') {
    return NOTE_EXCERPT_MAX_UNITS_EN;
  }
  return NOTE_EXCERPT_MAX_UNITS_MIXED;
}

function getCharVisualUnits(char: string) {
  return isHanCharacter(char) ? 2 : 1;
}

function truncateByVisualUnits(value: string, maxUnits: number) {
  let units = 0;
  let output = '';
  for (const char of value) {
    const nextUnits = units + getCharVisualUnits(char);
    if (nextUnits > maxUnits) {
      return `${output}${ELLIPSIS_MARK}`;
    }
    output += char;
    units = nextUnits;
  }
  return output;
}
</script>

<template>
  <div class="grid gap-4">
    <section class="card">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">笔记</h2>
          <p class="text-sm text-gray-500">自动保存，支持 Markdown 预览。</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ElButton type="primary" :disabled="saving" @click="createNote">
            <Icon icon="carbon:add-alt" class="mr-1" />
            新增笔记
          </ElButton>
          <ElButton :loading="loading" @click="loadAll">
            <Icon icon="carbon:renew" class="mr-1" />
            {{ loading ? '刷新中...' : '刷新' }}
          </ElButton>
        </div>
      </div>

      <ElInput v-model="searchQuery" clearable placeholder="按标题或内容搜索..." />
    </section>

    <section class="notes-layout">
      <aside class="card">
        <div v-if="loading" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          加载中...
        </div>
        <ElAlert v-else-if="errorMessage" :closable="false" show-icon type="error" :title="errorMessage" />
        <template v-else>
          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <strong class="text-sm text-gray-900">置顶</strong>
              <ElTag size="small">{{ pinnedNotes.length }}</ElTag>
            </div>
            <button
              v-for="note in pinnedNotes"
              :key="note.id"
              type="button"
              class="list-card w-full text-left"
              :class="{
                'list-card-active': selectedNoteId === note.id,
                'notes-note-button-highlight': highlightedId === note.id
              }"
              @click="selectedNoteId = note.id"
            >
              <div class="min-w-0">
                <strong class="block truncate text-sm text-gray-900">{{ getNoteDisplayTitle(note.title) }}</strong>
                <p class="truncate text-xs text-gray-500">{{ noteExcerpt(note.content) }}</p>
              </div>
            </button>
          </div>

          <div class="mt-3 grid gap-2">
            <div class="flex items-center justify-between">
              <strong class="text-sm text-gray-900">最近</strong>
              <ElTag size="small" type="info">{{ recentNotes.length }}</ElTag>
            </div>
            <button
              v-for="note in recentNotes"
              :key="note.id"
              type="button"
              class="list-card w-full text-left"
              :class="{
                'list-card-active': selectedNoteId === note.id,
                'notes-note-button-highlight': highlightedId === note.id
              }"
              @click="selectedNoteId = note.id"
            >
              <div class="min-w-0">
                <strong class="block truncate text-sm text-gray-900">{{ getNoteDisplayTitle(note.title) }}</strong>
                <p class="truncate text-xs text-gray-500">{{ noteExcerpt(note.content) }}</p>
              </div>
            </button>
          </div>
        </template>
      </aside>

      <section class="card">
        <template v-if="selectedNote">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <ElRadioGroup v-model="viewMode" size="small">
              <ElRadioButton label="write">写作</ElRadioButton>
              <ElRadioButton label="preview">预览</ElRadioButton>
              <ElRadioButton label="split">分栏</ElRadioButton>
            </ElRadioGroup>
            <div class="flex flex-wrap gap-2">
              <ElButton size="small" @click="togglePin">
                <Icon :icon="selectedNote.isPinned ? 'carbon:star-filled' : 'carbon:star'" class="mr-1" />
                {{ selectedNote.isPinned ? '取消置顶' : '置顶' }}
              </ElButton>
              <ElButton size="small" type="danger" @click="deleteTarget = selectedNote">
                <Icon icon="carbon:trash-can" class="mr-1" />
                删除
              </ElButton>
            </div>
          </div>

          <div class="grid gap-3">
            <ElInput v-model="editTitle" placeholder="笔记标题" />
            <p class="text-xs text-gray-500">
              字数 {{ characterCount }} · 行数 {{ lineCount }} · 更新 {{ formatDateTime(selectedNote.updatedAt) }}
            </p>

            <div v-if="viewMode === 'write'" class="notes-editor">
              <textarea v-model="editContent" class="notes-editor-textarea" />
            </div>

            <div v-else-if="viewMode === 'preview'" class="notes-preview" v-html="renderedPreview"></div>

            <div v-else class="grid gap-3 md:grid-cols-2">
              <div class="notes-editor">
                <textarea v-model="editContent" class="notes-editor-textarea" />
              </div>
              <div class="notes-preview" v-html="renderedPreview"></div>
            </div>
          </div>
        </template>

        <div v-else class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
          请选择一条笔记开始编辑。
        </div>
      </section>
    </section>

    <ConfirmModal
      :open="Boolean(deleteTarget)"
      title="删除笔记"
      :message="`确认删除「${deleteTarget?.title || '无标题'}」？`"
      confirm-text="删除"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.notes-layout {
  display: grid;
  gap: 16px;
  grid-template-columns: 300px minmax(0, 1fr);
}

.notes-note-button-highlight {
  box-shadow: 0 0 0 3px rgba(123, 68, 26, 0.15);
}

.notes-editor {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  min-height: 320px;
}

.notes-editor-textarea {
  width: 100%;
  min-height: 320px;
  border: 0;
  outline: 0;
  resize: vertical;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #111827;
}

.notes-preview {
  min-height: 320px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 12px;
  overflow: auto;
  color: #1f2937;
  line-height: 1.65;
  word-break: break-word;
}

.notes-preview :deep(pre) {
  background: #111827;
  color: #f9fafb;
  border-radius: 12px;
  padding: 12px;
  overflow: auto;
}

.notes-preview :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.notes-preview :deep(blockquote) {
  border-left: 3px solid #d1d5db;
  padding-left: 10px;
  color: #4b5563;
}

@media (max-width: 1100px) {
  .notes-layout {
    grid-template-columns: 1fr;
  }
}
</style>
