PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clipboard_items (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clipboard_items_type
  ON clipboard_items(type);

CREATE INDEX IF NOT EXISTS idx_clipboard_items_created_at
  ON clipboard_items(created_at);

CREATE INDEX IF NOT EXISTS idx_clipboard_items_is_pinned
  ON clipboard_items(is_pinned);
