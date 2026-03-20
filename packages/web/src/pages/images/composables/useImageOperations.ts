/**
 * 图片操作逻辑
 */

import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { imagesApi } from '../../../api/images';
import type { ImageRecord, ListType } from '@riku-hub/shared/types/images';

export function useImageOperations() {
  const operating = ref(false);

  /**
   * 删除图片
   */
  async function deleteImage(image: ImageRecord): Promise<boolean> {
    try {
      await ElMessageBox.confirm(
        `确定要删除「${image.fileName}」吗？`,
        '删除确认',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );

      operating.value = true;
      await imagesApi.delete(image.id);
      ElMessage.success('删除成功');
      return true;
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(error instanceof Error ? error.message : '删除失败');
      }
      return false;
    } finally {
      operating.value = false;
    }
  }

  /**
   * 批量删除
   */
  async function batchDelete(images: ImageRecord[]): Promise<number> {
    if (images.length === 0) {
      ElMessage.warning('请先选择文件');
      return 0;
    }

    try {
      await ElMessageBox.confirm(
        `确定要删除这 ${images.length} 个文件吗？`,
        '批量删除确认',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );

      operating.value = true;
      let successCount = 0;

      for (const image of images) {
        try {
          await imagesApi.delete(image.id);
          successCount++;
        } catch (error) {
          console.error('Delete error:', error);
        }
      }

      if (successCount > 0) {
        ElMessage.success(`成功删除 ${successCount} 个文件`);
      }

      if (successCount < images.length) {
        ElMessage.warning(`${images.length - successCount} 个文件删除失败`);
      }

      return successCount;
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error('批量删除失败');
      }
      return 0;
    } finally {
      operating.value = false;
    }
  }

  /**
   * 切换收藏
   */
  async function toggleLike(image: ImageRecord): Promise<ImageRecord | null> {
    try {
      operating.value = true;
      const updated = await imagesApi.toggleLike(image.id);
      ElMessage.success(updated.isLiked ? '已收藏' : '已取消收藏');
      return updated;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally {
      operating.value = false;
    }
  }

  /**
   * 修改文件名
   */
  async function updateName(image: ImageRecord): Promise<ImageRecord | null> {
    try {
      const { value } = await ElMessageBox.prompt('', '修改文件名', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: image.fileName,
        inputValidator: (value) => {
          if (!value || value.trim().length === 0) {
            return '文件名不能为空';
          }
          if (value.length > 64) {
            return '文件名不能超过 64 个字符';
          }
          return true;
        }
      });

      operating.value = true;
      const updated = await imagesApi.updateName(image.id, value.trim());
      ElMessage.success('修改成功');
      return updated;
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(error instanceof Error ? error.message : '修改失败');
      }
      return null;
    } finally {
      operating.value = false;
    }
  }

  /**
   * 复制链接
   */
  async function copyLink(image: ImageRecord): Promise<void> {
    try {
      const url = `${window.location.origin}${imagesApi.getFileUrl(image.id)}`;
      await navigator.clipboard.writeText(url);
      ElMessage.success('链接已复制');
    } catch (error) {
      ElMessage.error('复制失败');
    }
  }

  /**
   * 批量复制链接
   */
  async function batchCopyLinks(images: ImageRecord[]): Promise<void> {
    if (images.length === 0) {
      ElMessage.warning('请先选择文件');
      return;
    }

    try {
      const links = images
        .map(img => `${window.location.origin}${imagesApi.getFileUrl(img.id)}`)
        .join('\n');
      
      await navigator.clipboard.writeText(links);
      ElMessage.success(`已复制 ${images.length} 个链接`);
    } catch (error) {
      ElMessage.error('复制失败');
    }
  }

  /**
   * 批量下载
   */
  function batchDownload(images: ImageRecord[]): void {
    if (images.length === 0) {
      ElMessage.warning('请先选择文件');
      return;
    }

    ElMessage.info(`正在下载 ${images.length} 个文件`);

    images.forEach((image, index) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = imagesApi.getFileUrl(image.id);
        link.download = image.fileName;
        link.click();
      }, index * 800);
    });
  }

  /**
   * 更新黑白名单
   */
  async function updateListType(image: ImageRecord, listType: ListType): Promise<ImageRecord | null> {
    try {
      operating.value = true;
      const updated = await imagesApi.updateListType(image.id, listType);
      const typeName = listType === 'Block' ? '黑名单' : listType === 'White' ? '白名单' : '';
      ElMessage.success(`已加入${typeName}`);
      return updated;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally {
      operating.value = false;
    }
  }

  /**
   * 批量更新黑白名单
   */
  async function batchUpdateListType(images: ImageRecord[], listType: ListType): Promise<number> {
    if (images.length === 0) {
      ElMessage.warning('请先选择文件');
      return 0;
    }

    const typeName = listType === 'Block' ? '黑名单' : '白名单';

    try {
      await ElMessageBox.confirm(
        `确定要将这 ${images.length} 个文件加入${typeName}吗？`,
        '批量操作确认',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }
      );

      operating.value = true;
      let successCount = 0;

      for (const image of images) {
        try {
          await imagesApi.updateListType(image.id, listType);
          successCount++;
        } catch (error) {
          console.error('Update error:', error);
        }
      }

      if (successCount > 0) {
        ElMessage.success(`成功将 ${successCount} 个文件加入${typeName}`);
      }

      if (successCount < images.length) {
        ElMessage.warning(`${images.length - successCount} 个文件操作失败`);
      }

      return successCount;
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error('批量操作失败');
      }
      return 0;
    } finally {
      operating.value = false;
    }
  }

  return {
    operating,
    deleteImage,
    batchDelete,
    toggleLike,
    updateName,
    copyLink,
    batchCopyLinks,
    batchDownload,
    updateListType,
    batchUpdateListType
  };
}
