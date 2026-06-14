/**
 * 图片上传逻辑
 */

import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { imagesApi } from '../../../api/images';
import type { ImageRecord } from '@riku-hub/shared/types/images';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_CONCURRENT = 3; // 最大并发上传数

export function useImageUpload() {
  const uploading = ref(false);
  const uploadProgress = ref<{ current: number; total: number }>({ current: 0, total: 0 });
  let abortController: AbortController | null = null;

  /**
   * 上传单个文件
   */
  async function uploadFile(file: File, signal?: AbortSignal): Promise<ImageRecord | null> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        signal
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '上传失败' }));
        throw new Error(error.error || '上传失败');
      }

      const data = await response.json();
      return data.image;
    } catch (error) {
      // 如果是取消操作，返回 null 而不是抛出错误
      if (error instanceof Error && error.name === 'AbortError') {
        return null;
      }
      throw error;
    }
  }

  /**
   * 批量上传文件
   */
  async function uploadFiles(files: File[]): Promise<{
    success: ImageRecord[];
    failed: Array<{ file: File; error: string }>;
  }> {
    if (files.length === 0) {
      return { success: [], failed: [] };
    }

    // 验证文件
    const validFiles: File[] = [];
    const invalidFiles: Array<{ file: File; error: string }> = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        invalidFiles.push({
          file,
          error: `文件大小超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`
        });
      } else {
        validFiles.push(file);
      }
    }

    if (invalidFiles.length > 0) {
      const names = invalidFiles.map(f => f.file.name).join(', ');
      ElMessage.error(`以下文件超过大小限制：${names}`);
    }

    if (validFiles.length === 0) {
      return { success: [], failed: invalidFiles };
    }

    abortController = new AbortController();
    uploading.value = true;
    uploadProgress.value = { current: 0, total: validFiles.length };
    const success: ImageRecord[] = [];
    const failed: Array<{ file: File; error: string }> = [];

    try {
      // 分批上传，控制并发
      for (let i = 0; i < validFiles.length; i += MAX_CONCURRENT) {
        const batch = validFiles.slice(i, i + MAX_CONCURRENT);
        const results = await Promise.allSettled(
          batch.map(file => uploadFile(file, abortController!.signal))
        );

        results.forEach((result, index) => {
          const file = batch[index];
          if (result.status === 'fulfilled' && result.value) {
            success.push(result.value);
          } else if (result.status === 'fulfilled' && result.value === null) {
            // 被取消，不计入失败
          } else {
            failed.push({
              file,
              error: result.status === 'rejected' ? result.reason?.message || '上传失败' : '上传失败'
            });
          }
          // 更新进度
          uploadProgress.value.current++;
        });

        // 如果被取消，停止后续批次
        if (abortController?.signal.aborted) {
          break;
        }
      }

      // 显示结果
      if (abortController?.signal.aborted) {
        ElMessage.info(`上传已取消，成功 ${success.length} 个`);
      } else {
        if (success.length > 0) {
          ElMessage.success(`成功上传 ${success.length} 个文件`);
        }

        if (failed.length > 0) {
          const names = failed.map(f => f.file.name).join(', ');
          ElMessage.error(`上传失败：${names}`);
        }
      }
    } finally {
      uploading.value = false;
      uploadProgress.value = { current: 0, total: 0 };
      abortController = null;
    }

    return { success, failed };
  }

  /**
   * 取消上传
   */
  function cancelUpload() {
    if (abortController) {
      abortController.abort();
    }
  }

  /**
   * 处理文件选择
   */
  async function handleFileSelect(event: Event): Promise<ImageRecord[]> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (files.length === 0) {
      return [];
    }

    const { success } = await uploadFiles(files);

    // 清空 input
    input.value = '';

    return success;
  }

  return {
    uploading,
    uploadProgress,
    uploadFile,
    uploadFiles,
    handleFileSelect,
    cancelUpload
  };
}
