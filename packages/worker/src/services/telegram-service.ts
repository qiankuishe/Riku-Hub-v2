/**
 * Telegram Bot API 服务
 * 用于上传文件到 Telegram 并获取文件链接
 */

import { API_ENDPOINTS } from '../config/api-endpoints';

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size: number;
}

export interface TelegramUploadResponse {
  ok: boolean;
  result?: {
    document?: TelegramFile;
    photo?: TelegramFile[];
    video?: TelegramFile;
    audio?: TelegramFile;
  };
  description?: string;
}

export interface TelegramFileResponse {
  ok: boolean;
  result?: {
    file_id: string;
    file_unique_id: string;
    file_size: number;
    file_path: string;
  };
  description?: string;
}

/**
 * 上传文件到 Telegram
 */
export async function uploadToTelegram(
  file: File,
  env: Env
): Promise<string> {
  // 验证环境变量
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN 未配置');
  }
  if (!env.TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_CHAT_ID 未配置');
  }

  const formData = new FormData();
  formData.append('chat_id', env.TELEGRAM_CHAT_ID);
  formData.append('document', file);

  const response = await fetch(
    `${API_ENDPOINTS.telegram.base(env.TELEGRAM_BOT_TOKEN)}/sendDocument`,
    {
      method: 'POST',
      body: formData
    }
  );

  const data = (await response.json()) as TelegramUploadResponse;

  if (!response.ok || !data.ok) {
    const errorMsg = data.description || `HTTP ${response.status}`;
    throw new Error(`Telegram API 错误: ${errorMsg}`);
  }

  if (!data.result?.document) {
    throw new Error('Telegram 响应中缺少文件信息');
  }

  return data.result.document.file_id;
}

/**
 * 获取 Telegram 文件的访问 URL
 */
export async function getFileUrl(
  fileId: string,
  env: Env
): Promise<string> {
  const response = await fetch(
    `${API_ENDPOINTS.telegram.base(env.TELEGRAM_BOT_TOKEN)}/getFile?file_id=${fileId}`
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  const data = (await response.json()) as TelegramFileResponse;

  if (!data.ok || !data.result?.file_path) {
    throw new Error(data.description || 'Failed to get file URL');
  }

  return `${API_ENDPOINTS.telegram.file(env.TELEGRAM_BOT_TOKEN)}/${data.result.file_path}`;
}

/**
 * 代理 Telegram 文件访问
 * 用于隐藏 Bot Token
 */
export async function proxyTelegramFile(
  fileId: string,
  fileName: string,
  env: Env
): Promise<Response> {
  try {
    const fileUrl = await getFileUrl(fileId, env);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error('File not found');
    }

    // 根据文件扩展名确定 Content-Type
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    let contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    
    // 如果 Telegram 返回的是通用类型，根据扩展名设置正确的类型
    if (contentType === 'application/octet-stream' || !contentType.includes('/')) {
      const mimeTypes: Record<string, string> = {
        // 图片
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon',
        // 视频
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'video/ogg',
        'avi': 'video/x-msvideo',
        'mov': 'video/quicktime',
        // 音频
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'flac': 'audio/flac',
        'aac': 'audio/aac',
        'm4a': 'audio/mp4'
      };
      
      contentType = mimeTypes[ext] || 'application/octet-stream';
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response('File not found', { status: 404 });
  }
}

/**
 * 检测文件类型
 */
export function detectFileType(fileName: string, mimeType?: string): 'image' | 'video' | 'audio' | 'document' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'ico', 'svg'];
  const videoExts = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];

  if (imageExts.includes(ext) || mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (videoExts.includes(ext) || mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (audioExts.includes(ext) || mimeType?.startsWith('audio/')) {
    return 'audio';
  }

  return 'document';
}
