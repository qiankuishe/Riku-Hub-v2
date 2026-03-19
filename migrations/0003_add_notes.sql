PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS note_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_folders_parent_id
  ON note_folders(parent_id);

CREATE INDEX IF NOT EXISTS idx_note_versions_note_id
  ON note_versions(note_id);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at
  ON notes(updated_at);
