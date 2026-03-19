export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NoteCreateInput {
  title?: string;
  content?: string;
}

export interface NoteUpdateInput {
  title?: string;
  content?: string;
  isPinned?: boolean;
}

export interface NotesRepositoryDeps<TEnv> {
  getAllNotes: (env: TEnv) => Promise<NoteRecord[]>;
  getNoteRecord: (env: TEnv, id: string) => Promise<NoteRecord | null>;
  createNoteRecord: (env: TEnv, title: string, content: string) => Promise<NoteRecord>;
  saveNoteRecord: (env: TEnv, note: NoteRecord) => Promise<NoteRecord>;
  deleteNoteRecord: (env: TEnv, id: string) => Promise<void>;
}

