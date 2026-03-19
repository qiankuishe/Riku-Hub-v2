import { NotesRepository } from '../repositories/notes-repository';
import type { NoteCreateInput, NoteRecord, NoteUpdateInput } from '../types/notes';

export class NotesHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class NotesService<TEnv> {
  constructor(private readonly repository: NotesRepository<TEnv>) {}

  async listNotes(): Promise<{ notes: NoteRecord[] }> {
    return {
      notes: await this.repository.getAllNotes()
    };
  }

  async createNote(input: NoteCreateInput): Promise<{ note: NoteRecord }> {
    const note = await this.repository.createNoteRecord(input.title?.trim() || '新笔记', input.content ?? '');
    return { note };
  }

  async updateNote(id: string, input: NoteUpdateInput): Promise<{ note: NoteRecord }> {
    const note = await this.repository.getNoteRecord(id);
    if (!note) {
      throw new NotesHttpError(404, '笔记不存在');
    }

    const updated = await this.repository.saveNoteRecord({
      ...note,
      title: input.title?.trim() || note.title,
      content: typeof input.content === 'string' ? input.content : note.content,
      isPinned: typeof input.isPinned === 'boolean' ? input.isPinned : note.isPinned,
      updatedAt: new Date().toISOString()
    });

    return { note: updated };
  }

  async deleteNote(id: string): Promise<{ success: true }> {
    const note = await this.repository.getNoteRecord(id);
    if (!note) {
      throw new NotesHttpError(404, '笔记不存在');
    }
    await this.repository.deleteNoteRecord(note.id);
    return { success: true };
  }
}

