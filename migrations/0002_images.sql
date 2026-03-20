-- 图床功能数据表
-- 用于存储用户上传的图片、视频、音频和文件

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL CHECK(file_type IN ('image', 'video', 'audio', 'document')),
  telegram_file_id TEXT NOT NULL,
  is_liked INTEGER DEFAULT 0 CHECK(is_liked IN (0, 1)),
  list_type TEXT CHECK(list_type IN ('Block', 'White') OR list_type IS NULL),
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_file_type ON images(file_type);
CREATE INDEX IF NOT EXISTS idx_images_is_liked ON images(is_liked);
CREATE INDEX IF NOT EXISTS idx_images_list_type ON images(list_type);
CREATE INDEX IF NOT EXISTS idx_images_user_created ON images(user_id, created_at DESC);
