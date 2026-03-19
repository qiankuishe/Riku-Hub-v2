import type { NoteRecord, NotesRepositoryDeps } from '../types/notes';

export class NotesRepository<TEnv> {
  constructor(
    private readonly env: TEnv,
    private readonly deps: NotesRepositoryDeps<TEnv>
  ) {}

  getAllNotes(): Promise<NoteRecord[]> {
    return this.deps.getAllNotes(this.env);
  }

  getNoteRecord(id: string): Promise<NoteRecord | null> {
    return this.deps.getNoteRecord(this.env, id);
  }

  createNoteRecord(title: string, content: string): Promise<NoteRecord> {
    return this.deps.createNoteRecord(this.env, title, content);
  }

  saveNoteRecord(note: NoteRecord): Promise<NoteRecord> {
    return this.deps.saveNoteRecord(this.env, note);
  }

  deleteNoteRecord(id: string): Promise<void> {
    return this.deps.deleteNoteRecord(this.env, id);
  }
}

