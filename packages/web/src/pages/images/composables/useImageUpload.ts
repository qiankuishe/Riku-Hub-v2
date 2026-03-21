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
  const uploadProgress = ref<Map<string, number>>(new Map());

  /**
   * 上传单个文件
   */
  async function uploadFile(file: File): Promise<ImageRecord | null> {
    try {
      const image = await imagesApi.upload(file);
      return image;
    } catch (error) {
      // Error is already logged by API client, just rethrow
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

    uploading.value = true;
    const success: ImageRecord[] = [];
    const failed: Array<{ file: File; error: string }> = [];

    try {
      // 分批上传，控制并发
      for (let i = 0; i < validFiles.length; i += MAX_CONCURRENT) {
        const batch = validFiles.slice(i, i + MAX_CONCURRENT);
        const results = await Promise.allSettled(
          batch.map(file => uploadFile(file))
        );

        results.forEach((result, index) => {
          const file = batch[index];
          if (result.status === 'fulfilled' && result.value) {
            success.push(result.value);
          } else {
            failed.push({
              file,
              error: result.status === 'rejected' ? result.reason?.message || '上传失败' : '上传失败'
            });
          }
        });
      }

      // 显示结果
      if (success.length > 0) {
        ElMessage.success(`成功上传 ${success.length} 个文件`);
      }

      if (failed.length > 0) {
        const names = failed.map(f => f.file.name).join(', ');
        ElMessage.error(`上传失败：${names}`);
      }
    } finally {
      uploading.value = false;
    }

    return { success, failed };
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
    handleFileSelect
  };
}
