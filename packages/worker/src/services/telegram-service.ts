/**
 * Telegram Bot API 服务
 * 用于上传文件到 Telegram 并获取文件链接
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export interface TelegramFile {
  fileId: string;
  fileUniqueId: string;
  fileSize: number;
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
  const formData = new FormData();
  formData.append('chat_id', env.TELEGRAM_CHAT_ID);
  formData.append('document', file);

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    {
      method: 'POST',
      body: formData
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  const data = (await response.json()) as TelegramUploadResponse;

  if (!data.ok || !data.result?.document) {
    throw new Error(data.description || 'Failed to upload to Telegram');
  }

  return data.result.document.fileId;
}

/**
 * 获取 Telegram 文件的访问 URL
 */
export async function getFileUrl(
  fileId: string,
  env: Env
): Promise<string> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  const data = (await response.json()) as TelegramFileResponse;

  if (!data.ok || !data.result?.file_path) {
    throw new Error(data.description || 'Failed to get file URL');
  }

  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

/**
 * 代理 Telegram 文件访问
 * 用于隐藏 Bot Token
 */
export async function proxyTelegramFile(
  fileId: string,
  env: Env
): Promise<Response> {
  try {
    const fileUrl = await getFileUrl(fileId, env);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error('File not found');
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
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
