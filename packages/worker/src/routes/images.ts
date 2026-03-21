/**
 * Images API Routes
 * 图床功能 API 路由
 */

import { Hono } from 'hono';
import { ImagesRepository } from '../repositories/images-repository';
import { uploadToTelegram, proxyTelegramFile, detectFileType } from '../services/telegram-service';
import { logger } from '../utils/logger';
import type { ImageListParams } from '@riku-hub/shared/types/images';

interface Env {
  APP_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

type Variables = {
  userId: string;
};

type Bindings = { 
  Bindings: Env;
  Variables: Variables;
};

const images = new Hono<Bindings>();

/**
 * 获取图片列表
 * GET /api/images/list
 */
images.get('/list', async (c) => {
  const userId = c.get('userId');
  const params: ImageListParams = {
    limit: Number(c.req.query('limit')) || 100,
    fileType: (c.req.query('fileType') as any) || 'all',
    sortBy: (c.req.query('sortBy') as any) || 'dateDesc',
    filter: (c.req.query('filter') as any) || 'all',
    search: c.req.query('search') || ''
  };

  const repository = new ImagesRepository(c.env.DB);
  const { images, total } = await repository.list(userId, params);

  return c.json({
    images,
    total,
    cursor: null,
    hasMore: false
  });
});

/**
 * 上传文件
 * POST /api/images/upload
 */
images.post('/upload', async (c) => {
  const userId = c.get('userId');
  
  logger.debug('Upload request received', { userId, userIdType: typeof userId });
  
  const formData = await c.req.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return c.json({ error: '缺少文件' }, 400);
  }

  // 检查文件大小（20MB 限制）
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    logger.warn('File size exceeds limit', { userId, fileName: file.name, fileSize: file.size, limit: MAX_FILE_SIZE });
    return c.json({ error: '文件大小超过 20MB 限制' }, 400);
  }

  try {
    // 上传到 Telegram
    const telegramFileId = await uploadToTelegram(file, c.env);
    logger.debug('Telegram upload successful', { userId, telegramFileId, fileName: file.name });

    // 检测文件类型
    const fileType = detectFileType(file.name, file.type);
    logger.debug('File type detected', { userId, fileType, fileName: file.name });

    // 保存到数据库
    const repository = new ImagesRepository(c.env.DB);
    const createData = {
      userId,
      fileName: file.name,
      fileSize: file.size,
      fileType,
      telegramFileId
    };
    
    const image = await repository.create(createData);
    logger.info('Image uploaded successfully', { userId, imageId: image.id, fileName: file.name, fileSize: file.size });

    return c.json({ image });
  } catch (error) {
    logger.error('Image upload failed', error, { userId, fileName: file.name, fileSize: file.size });
    return c.json({ error: '上传失败' }, 500);
  }
});

/**
 * 获取文件（代理到 Telegram）
 * GET /api/images/file/:id/:filename (完整路径，兼容旧链接)
 */
images.get('/file/:id/:filename?', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const repository = new ImagesRepository(c.env.DB);
  const image = await repository.getById(id, userId);

  if (!image) {
    return c.json({ error: '文件不存在' }, 404);
  }

  return proxyTelegramFile(image.telegramFileId, image.fileName, c.env);
});

/**
 * 删除文件
 * DELETE /api/images/:id
 */
images.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const repository = new ImagesRepository(c.env.DB);
  await repository.delete(id, userId);

  return c.json({ success: true });
});

/**
 * 切换收藏状态
 * POST /api/images/:id/like
 */
images.post('/:id/like', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const repository = new ImagesRepository(c.env.DB);
  const image = await repository.toggleLike(id, userId);

  if (!image) {
    return c.json({ error: '文件不存在' }, 404);
  }

  return c.json({ image, success: true });
});

/**
 * 修改文件名
 * PUT /api/images/:id/name
 */
images.put('/:id/name', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const { name } = await c.req.json<{ name: string }>();

  if (!name || name.trim().length === 0) {
    return c.json({ error: '文件名不能为空' }, 400);
  }

  if (name.length > 64) {
    return c.json({ error: '文件名不能超过 64 个字符' }, 400);
  }

  const repository = new ImagesRepository(c.env.DB);
  const image = await repository.update(id, userId, { fileName: name.trim() });

  if (!image) {
    return c.json({ error: '文件不存在' }, 404);
  }

  return c.json({ image, success: true });
});

/**
 * 加入黑名单
 * POST /api/images/:id/block
 */
images.post('/:id/block', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const repository = new ImagesRepository(c.env.DB);
  const image = await repository.updateListType(id, userId, 'Block');

  if (!image) {
    return c.json({ error: '文件不存在' }, 404);
  }

  return c.json({ image, success: true });
});

/**
 * 加入白名单
 * POST /api/images/:id/unblock
 */
images.post('/:id/unblock', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const repository = new ImagesRepository(c.env.DB);
  const image = await repository.updateListType(id, userId, 'White');

  if (!image) {
    return c.json({ error: '文件不存在' }, 404);
  }

  return c.json({ image, success: true });
});

export default images;
