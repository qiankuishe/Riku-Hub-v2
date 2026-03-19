import { defineStore } from 'pinia';
import { ref } from 'vue';
import { notesApi, type NoteRecord } from '../api';

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<NoteRecord[]>([]);
  const loading = ref(false);
  const saving = ref(false);

  async function loadAll() {
    loading.value = true;
    try {
      const data = await notesApi.getAll();
      notes.value = data.notes;
    } finally {
      loading.value = false;
    }
  }

  async function createNote(payload?: { title?: string; content?: string }) {
    saving.value = true;
    try {
      const data = await notesApi.create(payload);
      notes.value = [data.note, ...notes.value];
      return data.note;
    } finally {
      saving.value = false;
    }
  }

  async function updateNote(id: string, payload: { title?: string; content?: string; isPinned?: boolean }) {
    saving.value = true;
    try {
      const data = await notesApi.update(id, payload);
      notes.value = notes.value.map((note) => (note.id === id ? data.note : note));
      notes.value.sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || right.updatedAt.localeCompare(left.updatedAt));
      return data.note;
    } finally {
      saving.value = false;
    }
  }

  async function deleteNote(id: string) {
    saving.value = true;
    try {
      await notesApi.delete(id);
      notes.value = notes.value.filter((note) => note.id !== id);
    } finally {
      saving.value = false;
    }
  }

  return {
    notes,
    loading,
    saving,
    loadAll,
    createNote,
    updateNote,
    deleteNote
  };
});
