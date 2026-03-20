-- 添加 short_id 字段
ALTER TABLE images ADD COLUMN short_id TEXT;

-- 为现有记录生成 short_id（取 id 的前 8 位）
UPDATE images SET short_id = SUBSTR(id, 1, 8);

-- 添加唯一索引
CREATE UNIQUE INDEX idx_images_short_id ON images(short_id);
