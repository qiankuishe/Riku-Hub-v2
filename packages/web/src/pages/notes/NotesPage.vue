<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElAlert, ElInput } from 'element-plus';
import { Icon } from '@iconify/vue';
import type { NoteRecord } from '../../api';
import { notesApi } from '../../api';
import ConfirmModal from '../shared/ConfirmModal.vue';
import UiButton from '../../components/ui/UiButton.vue';
import { useUiStore } from '../../stores/ui';
import { formatDateTime } from '../../utils/date';

type ViewMode = 'write' | 'preview';

const uiStore = useUiStore();
const initialFocusId = new URLSearchParams(window.location.search).get('focus');

const notes = ref<NoteRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const saveErrorMessage = ref('');
const searchQuery = ref('');
const selectedNoteId = ref<string | null>(null);
const editTitle = ref('');
const editContent = ref('');
const viewMode = ref<ViewMode>('write');
const renderedPreview = ref('');
const deleteTarget = ref<NoteRecord | null>(null);
const highlightedId = ref<string | null>(null);

interface PendingSavePayload {
  noteId: string;
  title: string;
  content: string;
}

let saveTimer = 0;
let previewRunId = 0;
let hydrating = false;
let markdownRenderer: ((value: string) => Promise<string>) | null = null;
let pendingSavePayload: PendingSavePayload | null = null;

const filtered = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  if (!needle) {
    return notes.value;
  }
  return notes.value.filter((note) => note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle));
});

const selectedNote = computed(() => notes.value.find((note) => note.id === selectedNoteId.value) ?? null);
const characterCount = computed(() => editContent.value.trim().length);
const lineCount = computed(() => (editContent.value ? editContent.value.split(/\r?\n/).length : 0));

watch(selectedNoteId, (nextId, previousId) => {
  if (!previousId || previousId === nextId) {
    return;
  }
  void flushPendingSaveFor(previousId, true);
});

watch(selectedNote, (note) => {
  hydrating = true;
  editTitle.value = note?.title ?? '';
  editContent.value = note?.content ?? '';
  saveErrorMessage.value = '';
  nextTick(() => {
    hydrating = false;
  });
});

watch([editTitle, editContent], () => {
  if (hydrating || !selectedNote.value) {
    return;
  }
  pendingSavePayload = {
    noteId: selectedNote.value.id,
    title: editTitle.value.trim() || '无标题',
    content: editContent.value
  };
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
  window.addEventListener('pagehide', handlePageHide);
  document.addEventListener('visibilitychange', handleVisibilityChange);
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
  window.removeEventListener('pagehide', handlePageHide);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
  }
  void flushPendingSave(true);
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
    saveErrorMessage.value = '';
    pendingSavePayload = null;
    uiStore.showToast('已创建笔记');
  } catch (error) {
    uiStore.showToast(error instanceof Error ? error.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

function toggleViewMode() {
  viewMode.value = viewMode.value === 'write' ? 'preview' : 'write';
}

async function saveNow(payload: PendingSavePayload, options?: { silent?: boolean }): Promise<boolean> {
  const target = notes.value.find((note) => note.id === payload.noteId);
  if (!target) {
    return true;
  }
  saving.value = true;
  try {
    const data = await notesApi.update(payload.noteId, {
      title: payload.title,
      content: payload.content
    });
    notes.value = notes.value.map((note) => (note.id === data.note.id ? data.note : note));
    notes.value.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt));
    if (pendingSavePayload && pendingSavePayload.noteId === payload.noteId && pendingSavePayload.content === payload.content && pendingSavePayload.title === payload.title) {
      pendingSavePayload = null;
    }
    saveErrorMessage.value = '';
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败';
    saveErrorMessage.value = message;
    if (!options?.silent) {
      uiStore.showToast(message);
    }
    pendingSavePayload = payload;
    return false;
  } finally {
    saving.value = false;
  }
}

function queueSave() {
  const payload = pendingSavePayload;
  if (!payload) {
    return;
  }
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    void saveNow(payload, { silent: false });
  }, 2000);
}

async function flushPendingSave(silent = true) {
  const payload = pendingSavePayload;
  if (!payload) {
    return;
  }
  await flushPendingSaveFor(payload.noteId, silent);
}

async function flushPendingSaveFor(noteId: string, silent = true) {
  const payload = pendingSavePayload;
  if (!payload || payload.noteId !== noteId) {
    return;
  }
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
  }
  await saveNow(payload, { silent });
}

function handlePageHide() {
  void flushPendingSave(true);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    void flushPendingSave(true);
  }
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

function getExcerpt(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '空白笔记';
  }
  return normalized.slice(0, 50);
}
</script>

<template>
  <div class="notes-layout">
    <!-- 左侧：编辑区 -->
    <section class="card notes-editor-section">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-gray-900">笔记</h2>
          <p class="text-sm text-gray-500">自动保存，支持 Markdown 预览。</p>
        </div>
        <UiButton :disabled="!selectedNote" @click="toggleViewMode">
          <Icon :icon="viewMode === 'write' ? 'carbon:view' : 'carbon:edit'" class="mr-1" />
          {{ viewMode === 'write' ? '切换到预览' : '切换到写作' }}
        </UiButton>
      </div>

      <template v-if="selectedNote">
        <ElAlert
          v-if="saveErrorMessage"
          class="mb-3"
          :closable="false"
          show-icon
          type="error"
          :title="saveErrorMessage"
        />
        <div class="notes-editor-content">
          <ElInput v-model="editTitle" placeholder="笔记标题" />
          <p class="text-xs text-gray-500">
            字数 {{ characterCount }} · 行数 {{ lineCount }} · 更新 {{ formatDateTime(selectedNote.updatedAt) }}
          </p>

          <div v-if="viewMode === 'write'" class="notes-editor">
            <textarea v-model="editContent" class="notes-editor-textarea" />
          </div>

          <div v-else class="notes-preview" v-html="renderedPreview"></div>
        </div>
      </template>

      <div v-else class="notes-empty-state">
        请选择或创建一条笔记开始编辑。
      </div>
    </section>

    <!-- 右侧：笔记列表 -->
    <section class="card notes-list-section">
      <div class="mb-4 notes-list-toolbar">
        <ElInput v-model="searchQuery" clearable placeholder="搜索笔记..." class="notes-search-input" />
        <div class="toolbar-actions">
          <UiButton variant="primary" :disabled="saving" @click="createNote">
            <Icon icon="carbon:add-alt" class="mr-1" />
            新增
          </UiButton>
          <UiButton :disabled="!selectedNote" @click="togglePin">
            <Icon :icon="selectedNote?.isPinned ? 'carbon:star-filled' : 'carbon:star'" class="mr-1" />
            {{ selectedNote?.isPinned ? '取消置顶' : '置顶' }}
          </UiButton>
          <UiButton variant="danger" :disabled="!selectedNote" @click="selectedNote && (deleteTarget = selectedNote)">
            <Icon icon="carbon:trash-can" class="mr-1" />
            删除
          </UiButton>
        </div>
      </div>

      <div class="notes-list-scroll">
        <div v-if="loading" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          加载中...
        </div>
        <ElAlert v-else-if="errorMessage" :closable="false" show-icon type="error" :title="errorMessage" />
        <div v-else-if="!filtered.length" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          暂无笔记
        </div>
        <div v-else class="notes-grid">
          <button
            v-for="note in filtered"
            :key="note.id"
            type="button"
            class="note-card"
            :class="{
              'note-card-active': selectedNoteId === note.id,
              'note-card-highlight': highlightedId === note.id
            }"
            @click="selectedNoteId = note.id"
          >
            <div class="note-card-header">
              <Icon v-if="note.isPinned" icon="carbon:star-filled" class="note-card-star" />
              <strong class="note-card-title">{{ note.title || '无标题' }}</strong>
            </div>
            <p class="note-card-excerpt">{{ getExcerpt(note.content) }}</p>
            <p class="note-card-time">{{ formatDateTime(note.updatedAt) }}</p>
          </button>
        </div>
      </div>
    </section>
  </div>

  <ConfirmModal
    :open="Boolean(deleteTarget)"
    title="删除笔记"
    :message="`确认删除「${deleteTarget?.title || '无标题'}」？`"
    confirm-text="删除"
    @close="deleteTarget = null"
    @confirm="confirmDelete"
  />
</template>

<style scoped>
.notes-list-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.notes-search-input {
  flex: 1 1 220px;
  min-width: 180px;
}

.notes-layout {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  height: calc(100vh - 8px - 16px);
  overflow: hidden;
}

.notes-editor-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notes-editor-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.notes-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px dashed #d1d5db;
  background: #f9fafb;
  color: #6b7280;
  font-size: 14px;
}

.notes-editor {
  flex: 1;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  min-height: 0;
}

.notes-editor-textarea {
  width: 100%;
  height: 100%;
  border: 0;
  outline: 0;
  resize: none;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #111827;
}

.notes-preview {
  flex: 1;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 12px;
  overflow: auto;
  color: #1f2937;
  line-height: 1.65;
  word-break: break-word;
  min-height: 0;
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

.notes-list-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notes-list-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.notes-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.note-card {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  transition: all 0.15s;
  cursor: pointer;
}

.note-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.note-card-active {
  border-color: rgba(0, 0, 0, 0.16);
  background: rgba(0, 0, 0, 0.08);
}

.note-card-highlight {
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.15);
}

.note-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  min-width: 0;
}

.note-card-star {
  flex-shrink: 0;
  color: #f59e0b;
  font-size: 14px;
}

.note-card-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-card-excerpt {
  margin: 0 0 6px 0;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.note-card-time {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

@media (max-width: 1100px) {
  .notes-layout {
    grid-template-columns: 1fr;
    height: auto;
  }
  
  .notes-editor-section {
    height: auto;
  }
  
  .notes-list-section {
    height: 600px;
  }
  
  .notes-grid {
    grid-template-columns: 1fr;
  }
}
</style>
