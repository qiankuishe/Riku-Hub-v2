/**
 * Images API Client
 * 图床功能前端 API 客户端
 */

import type {
  ImageRecord,
  ImageListParams,
  ImageListResponse,
  UploadResponse,
  ListType
} from '@riku-hub/shared/types/images';

const BASE_URL = '/api/images';

/**
 * 获取图片列表
 */
export async function getList(params: ImageListParams = {}): Promise<ImageListResponse> {
  const searchParams = new URLSearchParams();
  
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.fileType) searchParams.set('fileType', params.fileType);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.filter) searchParams.set('filter', params.filter);
  if (params.search) searchParams.set('search', params.search);

  const response = await fetch(`${BASE_URL}/list?${searchParams.toString()}`, {
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '获取列表失败' }));
    throw new Error(error.error || '获取列表失败');
  }

  return response.json();
}

/**
 * 上传文件
 */
export async function upload(file: File): Promise<ImageRecord> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '上传失败' }));
    throw new Error(error.error || '上传失败');
  }

  const data: UploadResponse = await response.json();
  return data.image;
}

/**
 * 删除文件
 */
export async function deleteImage(id: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '删除失败' }));
    throw new Error(error.error || '删除失败');
  }
}

/**
 * 切换收藏状态
 */
export async function toggleLike(id: string): Promise<ImageRecord> {
  const response = await fetch(`${BASE_URL}/${id}/like`, {
    method: 'POST',
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '操作失败' }));
    throw new Error(error.error || '操作失败');
  }

  const data = await response.json();
  return data.image;
}

/**
 * 修改文件名
 */
export async function updateName(id: string, name: string): Promise<ImageRecord> {
  const response = await fetch(`${BASE_URL}/${id}/name`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name }),
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '修改失败' }));
    throw new Error(error.error || '修改失败');
  }

  const data = await response.json();
  return data.image;
}

/**
 * 更新黑白名单状态
 */
export async function updateListType(id: string, listType: ListType): Promise<ImageRecord> {
  const endpoint = listType === 'Block' ? 'block' : listType === 'White' ? 'unblock' : '';
  
  if (!endpoint) {
    throw new Error('无效的列表类型');
  }

  const response = await fetch(`${BASE_URL}/${id}/${endpoint}`, {
    method: 'POST',
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '操作失败' }));
    throw new Error(error.error || '操作失败');
  }

  const data = await response.json();
  return data.image;
}

/**
 * 获取文件 URL
 */
export function getFileUrl(id: string): string {
  return `${BASE_URL}/file/${id}`;
}

export const imagesApi = {
  getList,
  upload,
  delete: deleteImage,
  toggleLike,
  updateName,
  updateListType,
  getFileUrl
};
