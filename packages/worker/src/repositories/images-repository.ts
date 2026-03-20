/**
 * Images Repository
 * 图床数据访问层
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  ImageRecord,
  ImageListParams,
  CreateImageData,
  UpdateImageData,
  FileType,
  ListType,
  FilterOption
} from '@riku-hub/shared/types/images';

export class ImagesRepository {
  constructor(private db: D1Database) {}

  /**
   * 获取图片列表
   */
  async list(userId: string, params: ImageListParams = {}): Promise<{ images: ImageRecord[]; total: number }> {
    const {
      limit = 100,
      fileType = 'all',
      sortBy = 'dateDesc',
      filter = 'all',
      search = ''
    } = params;

    let query = 'SELECT * FROM images WHERE user_id = ?';
    const bindings: unknown[] = [userId];

    // 文件类型筛选
    if (fileType !== 'all') {
      query += ' AND file_type = ?';
      bindings.push(fileType);
    }

    // 筛选条件
    if (filter === 'favorites') {
      query += ' AND is_liked = 1';
    } else if (filter === 'blocked') {
      query += ' AND list_type = ?';
      bindings.push('Block');
    } else if (filter === 'unblocked') {
      query += ' AND list_type = ?';
      bindings.push('White');
    } else if (filter === 'adult') {
      query += ' AND label = ?';
      bindings.push('adult');
    }

    // 搜索
    if (search) {
      query += ' AND (file_name LIKE ? OR id LIKE ?)';
      const searchPattern = `%${search}%`;
      bindings.push(searchPattern, searchPattern);
    }

    // 排序
    if (sortBy === 'dateDesc') {
      query += ' ORDER BY created_at DESC';
    } else if (sortBy === 'nameAsc') {
      query += ' ORDER BY file_name ASC';
    } else if (sortBy === 'sizeDesc') {
      query += ' ORDER BY file_size DESC';
    }

    // 限制数量
    query += ' LIMIT ?';
    bindings.push(limit);

    const result = await this.db.prepare(query).bind(...bindings).all<{
      id: string;
      user_id: string;
      file_name: string;
      file_size: number;
      file_type: FileType;
      telegram_file_id: string;
      is_liked: number;
      list_type: ListType;
      label: string | null;
      created_at: number;
      updated_at: number;
    }>();

    // 获取总数
    let countQuery = 'SELECT COUNT(*) as count FROM images WHERE user_id = ?';
    const countBindings: unknown[] = [userId];

    if (fileType !== 'all') {
      countQuery += ' AND file_type = ?';
      countBindings.push(fileType);
    }

    const countResult = await this.db.prepare(countQuery).bind(...countBindings).first<{ count: number }>();
    const total = countResult?.count || 0;

    const images = result.results.map((row) => ({
      id: row.id,
      userId: row.user_id,
      fileName: row.file_name,
      fileSize: row.file_size,
      fileType: row.file_type,
      telegramFileId: row.telegram_file_id,
      isLiked: row.is_liked === 1,
      listType: row.list_type,
      label: row.label,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return { images, total };
  }

  /**
   * 根据 ID 获取图片
   */
  async getById(id: string, userId: string): Promise<ImageRecord | null> {
    const result = await this.db
      .prepare('SELECT * FROM images WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<{
        id: string;
        user_id: string;
        file_name: string;
        file_size: number;
        file_type: FileType;
        telegram_file_id: string;
        is_liked: number;
        list_type: ListType;
        label: string | null;
        created_at: number;
        updated_at: number;
      }>();

    if (!result) {
      return null;
    }

    return {
      id: result.id,
      userId: result.user_id,
      fileName: result.file_name,
      fileSize: result.file_size,
      fileType: result.file_type,
      telegramFileId: result.telegram_file_id,
      isLiked: result.is_liked === 1,
      listType: result.list_type,
      label: result.label,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  }

  /**
   * 创建图片记录
   */
  async create(data: CreateImageData): Promise<ImageRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.db
      .prepare(
        `INSERT INTO images (
          id, user_id, file_name, file_size, file_type, telegram_file_id,
          is_liked, list_type, label, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`
      )
      .bind(
        id,
        data.userId,
        data.fileName,
        data.fileSize,
        data.fileType,
        data.telegramFileId,
        data.label || null,
        now,
        now
      )
      .run();

    return {
      id,
      userId: data.userId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      fileType: data.fileType,
      telegramFileId: data.telegramFileId,
      isLiked: false,
      listType: null,
      label: data.label || null,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * 更新图片记录
   */
  async update(id: string, userId: string, data: UpdateImageData): Promise<ImageRecord | null> {
    const updates: string[] = [];
    const bindings: unknown[] = [];

    if (data.fileName !== undefined) {
      updates.push('file_name = ?');
      bindings.push(data.fileName);
    }

    if (data.isLiked !== undefined) {
      updates.push('is_liked = ?');
      bindings.push(data.isLiked ? 1 : 0);
    }

    if (data.listType !== undefined) {
      updates.push('list_type = ?');
      bindings.push(data.listType);
    }

    if (data.label !== undefined) {
      updates.push('label = ?');
      bindings.push(data.label);
    }

    if (updates.length === 0) {
      return this.getById(id, userId);
    }

    updates.push('updated_at = ?');
    bindings.push(Date.now());

    bindings.push(id, userId);

    await this.db
      .prepare(`UPDATE images SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...bindings)
      .run();

    return this.getById(id, userId);
  }

  /**
   * 删除图片记录
   */
  async delete(id: string, userId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM images WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
  }

  /**
   * 切换收藏状态
   */
  async toggleLike(id: string, userId: string): Promise<ImageRecord | null> {
    const image = await this.getById(id, userId);
    if (!image) {
      return null;
    }

    return this.update(id, userId, { isLiked: !image.isLiked });
  }

  /**
   * 更新黑白名单状态
   */
  async updateListType(id: string, userId: string, listType: ListType): Promise<ImageRecord | null> {
    return this.update(id, userId, { listType });
  }
}
