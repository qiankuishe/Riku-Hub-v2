<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { ElInput, ElDropdown, ElDropdownMenu, ElDropdownItem, ElPagination, ElMessage, ElDialog } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useImageList } from './composables/useImageList';
import { useImageUpload } from './composables/useImageUpload';
import { useImageOperations } from './composables/useImageOperations';
import { imagesApi } from '../../api/images';
import UiButton from '../../components/ui/UiButton.vue';
import { useUiStore } from '../../stores/ui';
import type { ImageRecord, FileType } from '@riku-hub/shared/types/images';

const uiStore = useUiStore();

// Composables
const {
  images,
  loading,
  error,
  total,
  fileType,
  sortOption,
  filterOption,
  searchQuery,
  currentPage,
  pageSize,
  selectedFiles,
  filteredImages,
  paginatedImages,
  fileTypeStats,
  selectedImages,
  loadImages,
  switchFileType,
  switchSort,
  switchFilter,
  toggleSelect,
  selectAllInPage,
  clearSelection,
  handlePageChange,
  refresh
} = useImageList();

const { uploading, handleFileSelect } = useImageUpload();

const {
  operating,
  deleteImage,
  batchDelete,
  toggleLike,
  updateName,
  copyLink,
  copyMarkdown,
  batchCopyLinks,
  batchDownload,
  updateListType,
  batchUpdateListType
} = useImageOperations();

// Refs
const fileInput = ref<HTMLInputElement | null>(null);
const showSettingsDialog = ref(false);
const showPreviewDialog = ref(false);
const previewImage = ref<ImageRecord | null>(null);
const fileNamePrefix = ref(localStorage.getItem('imageNamePrefix') || 'img');

// 文件类型配置
const fileTypeConfig = {
  image: { name: '图片', icon: 'carbon:image' },
  video: { name: '视频', icon: 'carbon:video' },
  audio: { name: '音频', icon: 'carbon:music' },
  document: { name: '文件', icon: 'carbon:document' }
};

// 计算属性
const fileTypeIcon = computed(() => {
  if (fileType.value === 'all') return 'carbon:folder-open';
  return fileTypeConfig[fileType.value as FileType]?.icon || 'carbon:document';
});

const sortIcon = computed(() => {
  return sortOption.value === 'dateDesc' ? 'carbon:sort-descending' :
         sortOption.value === 'nameAsc' ? 'carbon:sort-ascending' :
         'carbon:sort-descending';
});

const filterIcon = computed(() => {
  return filterOption.value === 'all' ? 'carbon:filter' :
         filterOption.value === 'favorites' ? 'carbon:star-filled' :
         filterOption.value === 'blocked' ? 'carbon:locked' :
         filterOption.value === 'unblocked' ? 'carbon:unlocked' :
         'carbon:filter';
});

// 生成随机文件名
function generateFileName(originalName: string): string {
  const ext = originalName.split('.').pop() || '';
  const prefix = fileNamePrefix.value || 'img';
  const randomStr = generateRandomString(5);
  return `${prefix}_${randomStr}.${ext}`;
}

// 生成随机字符串（字母和数字）
function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 检查文件名是否已存在
function isFileNameExists(fileName: string): boolean {
  return images.value.some(img => img.fileName === fileName);
}

// 生成唯一文件名
function generateUniqueFileName(originalName: string): string {
  let fileName = generateFileName(originalName);
  let attempts = 0;
  const maxAttempts = 10;
  
  while (isFileNameExists(fileName) && attempts < maxAttempts) {
    fileName = generateFileName(originalName);
    attempts++;
  }
  
  return fileName;
}

// 方法
function handleUploadClick() {
  fileInput.value?.click();
}

async function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  // 重命名文件
  const renamedFiles: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const newFileName = generateUniqueFileName(file.name);
    const renamedFile = new File([file], newFileName, { type: file.type });
    renamedFiles.push(renamedFile);
  }

  // 创建新的 FileList（通过 DataTransfer）
  const dataTransfer = new DataTransfer();
  renamedFiles.forEach(file => dataTransfer.items.add(file));
  input.files = dataTransfer.files;

  const newImages = await handleFileSelect(event);
  if (newImages.length > 0) {
    await refresh();
  }
  
  // 清空 input
  input.value = '';
}

async function handleDelete(image: ImageRecord) {
  const success = await deleteImage(image);
  if (success) {
    await refresh();
  }
}

async function handleBatchDelete() {
  const count = await batchDelete(selectedImages.value);
  if (count > 0) {
    clearSelection();
    await refresh();
  }
}

async function handleToggleLike(image: ImageRecord) {
  const updated = await toggleLike(image);
  if (updated) {
    const index = images.value.findIndex(img => img.id === image.id);
    if (index !== -1) {
      images.value[index] = updated;
    }
  }
}

async function handleUpdateName(image: ImageRecord) {
  const updated = await updateName(image);
  if (updated) {
    const index = images.value.findIndex(img => img.id === image.id);
    if (index !== -1) {
      images.value[index] = updated;
    }
  }
}

function saveSettings() {
  localStorage.setItem('imageNamePrefix', fileNamePrefix.value);
  showSettingsDialog.value = false;
  ElMessage.success('设置已保存');
}

function handlePreview(image: ImageRecord) {
  previewImage.value = image;
  showPreviewDialog.value = true;
}

function handleDownload(image: ImageRecord) {
  const link = document.createElement('a');
  link.href = imagesApi.getFileUrl(image.id, image.shortId, image.fileName);
  link.download = image.fileName;
  link.click();
  ElMessage.success('开始下载');
}

function getFileUrl(id: string, shortId: string, fileName?: string): string {
  return imagesApi.getFileUrl(id, shortId, fileName);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function checkInvalidFiles() {
  if (images.value.length === 0) {
    ElMessage.warning('暂无文件可检测');
    return;
  }

  const loadingMessage = ElMessage({
    message: '正在检测失效文件...',
    type: 'info',
    duration: 0
  });

  try {
    let invalidCount = 0;
    const batchSize = 10; // 每批检测10个文件
    
    for (let i = 0; i < images.value.length; i += batchSize) {
      const batch = images.value.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (image) => {
          try {
            const url = getFileUrl(image.id, image.shortId, image.fileName);
            const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
            return response.ok;
          } catch {
            return false;
          }
        })
      );
      
      invalidCount += results.filter(r => r.status === 'fulfilled' && !r.value).length;
    }

    loadingMessage.close();
    
    if (invalidCount === 0) {
      ElMessage.success('所有文件都正常');
    } else {
      ElMessage.warning(`发现 ${invalidCount} 个失效文件`);
    }
  } catch (error) {
    loadingMessage.close();
    ElMessage.error('检测过程出错');
  }
}

// 生命周期
onMounted(() => {
  loadImages();
});
</script>

<template>
  <div class="card">
    <!-- 顶部标题和工具栏 -->
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div class="images-title-row">
        <button type="button" class="mobile-menu-btn" @click="uiStore.openMobileNav">
          <Icon icon="carbon:menu" />
        </button>
        <div>
          <h2 class="text-xl font-semibold text-gray-900">图床</h2>
          <p class="text-sm text-gray-500">管理你的图片、视频、音频和文件。{{ total }} 个文件</p>
        </div>
      </div>

      <!-- 工具栏 - 右上角 -->
      <div class="toolbar-actions">
        <!-- 搜索框 -->
        <ElInput
          v-model="searchQuery"
          clearable
          placeholder="搜索文件名..."
          size="small"
          style="width: 200px"
        >
          <template #prefix>
            <Icon icon="carbon:search" />
          </template>
        </ElInput>

        <!-- 批量操作（选中时显示） -->
        <ElDropdown v-if="selectedImages.length > 0" trigger="click">
          <UiButton size="small" type="primary">
            <Icon icon="carbon:task" class="mr-1" />
            批量 ({{ selectedImages.length }})
          </UiButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem @click="batchCopyLinks(selectedImages)">
                <Icon icon="carbon:link" class="mr-1" />
                复制链接
              </ElDropdownItem>
              <ElDropdownItem @click="batchDownload(selectedImages)">
                <Icon icon="carbon:download" class="mr-1" />
                下载
              </ElDropdownItem>
              <ElDropdownItem @click="() => batchUpdateListType(selectedImages, 'Block')">
                <Icon icon="carbon:locked" class="mr-1" />
                加入黑名单
              </ElDropdownItem>
              <ElDropdownItem @click="() => batchUpdateListType(selectedImages, 'White')">
                <Icon icon="carbon:unlocked" class="mr-1" />
                加入白名单
              </ElDropdownItem>
              <ElDropdownItem divided @click="handleBatchDelete">
                <Icon icon="carbon:trash-can" class="mr-1" />
                删除
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 上传 -->
        <UiButton type="primary" size="small" :loading="uploading" @click="handleUploadClick">
          <Icon icon="carbon:upload" class="mr-1" />
          上传
        </UiButton>

        <!-- 排序 -->
        <ElDropdown trigger="click" @command="switchSort">
          <UiButton size="small">
            <Icon :icon="sortIcon" class="mr-1" />
            排序
          </UiButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="dateDesc">最新优先</ElDropdownItem>
              <ElDropdownItem command="nameAsc">名称排序</ElDropdownItem>
              <ElDropdownItem command="sizeDesc">大小排序</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 筛选 -->
        <ElDropdown trigger="click" @command="switchFilter">
          <UiButton size="small">
            <Icon :icon="filterIcon" class="mr-1" />
            筛选
          </UiButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="all">全部</ElDropdownItem>
              <ElDropdownItem command="favorites">收藏</ElDropdownItem>
              <ElDropdownItem command="blocked">黑名单</ElDropdownItem>
              <ElDropdownItem command="unblocked">白名单</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 分类（文件类型） -->
        <ElDropdown trigger="click" @command="switchFileType">
          <UiButton size="small">
            <Icon :icon="fileTypeIcon" class="mr-1" />
            {{ fileType === 'all' ? '分类' : fileTypeConfig[fileType as FileType]?.name }}
          </UiButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="all">全部 ({{ total }})</ElDropdownItem>
              <ElDropdownItem command="image">图片 ({{ fileTypeStats.image }})</ElDropdownItem>
              <ElDropdownItem command="video">视频 ({{ fileTypeStats.video }})</ElDropdownItem>
              <ElDropdownItem command="audio">音频 ({{ fileTypeStats.audio }})</ElDropdownItem>
              <ElDropdownItem command="document">文件 ({{ fileTypeStats.document }})</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 工具 -->
        <ElDropdown trigger="click">
          <UiButton size="small">
            <Icon icon="carbon:tools" class="mr-1" />
            工具
          </UiButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem @click="selectAllInPage">
                <Icon icon="carbon:checkbox-checked" class="mr-1" />
                全选当前页
              </ElDropdownItem>
              <ElDropdownItem @click="clearSelection" :disabled="selectedImages.length === 0">
                <Icon icon="carbon:checkbox" class="mr-1" />
                取消选择
              </ElDropdownItem>
              <ElDropdownItem divided @click="checkInvalidFiles">
                <Icon icon="carbon:warning" class="mr-1" />
                检测失效文件
              </ElDropdownItem>
              <ElDropdownItem divided @click="showSettingsDialog = true">
                <Icon icon="carbon:settings" class="mr-1" />
                设置
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      multiple
      accept="*/*"
      style="display: none"
      @change="onFileSelect"
    />

    <!-- 加载状态 -->
    <div v-if="loading" class="empty-state">
      <Icon icon="carbon:renew" class="loading-icon" />
      <p>加载中...</p>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="empty-state">
      <Icon icon="carbon:warning" class="error-icon" />
      <p>{{ error }}</p>
      <UiButton size="small" @click="refresh">重试</UiButton>
    </div>

    <!-- 空状态 -->
    <div v-else-if="paginatedImages.length === 0" class="empty-state">
      <Icon icon="carbon:cloud-upload" class="empty-icon" />
      <p>暂无文件</p>
      <UiButton type="primary" size="small" @click="handleUploadClick">上传文件</UiButton>
    </div>

    <!-- 文件网格 -->
    <div v-else class="images-grid">
      <div
        v-for="image in paginatedImages"
        :key="image.id"
        class="image-card"
        :class="{ 'is-selected': selectedFiles.has(image.id) }"
        @click="toggleSelect(image.id)"
      >
        <!-- 收藏图标 -->
        <button
          class="collect-icon"
          :class="{ liked: image.isLiked }"
          @click.stop="handleToggleLike(image)"
        >
          <Icon :icon="image.isLiked ? 'carbon:star-filled' : 'carbon:star'" />
        </button>

        <!-- 选择框 -->
        <div class="select-checkbox" :class="{ checked: selectedFiles.has(image.id) }">
          <Icon :icon="selectedFiles.has(image.id) ? 'carbon:checkbox-checked' : 'carbon:checkbox'" />
        </div>

        <!-- 图片预览 -->
        <div v-if="image.fileType === 'image'" class="image-preview">
          <img :src="getFileUrl(image.id, image.shortId, image.fileName)" :alt="image.fileName" />
        </div>

        <!-- 视频预览 -->
        <div v-else-if="image.fileType === 'video'" class="video-preview">
          <video :src="getFileUrl(image.id, image.shortId, image.fileName)" />
          <Icon icon="carbon:play-filled" class="play-icon" />
        </div>

        <!-- 音频预览 -->
        <div v-else-if="image.fileType === 'audio'" class="file-preview">
          <Icon icon="carbon:music" class="file-icon" />
        </div>

        <!-- 文件预览 -->
        <div v-else class="file-preview">
          <Icon icon="carbon:document" class="file-icon" />
        </div>

        <!-- 操作按钮 -->
        <div class="image-overlay">
          <div class="overlay-buttons">
            <UiButton size="small" circle @click.stop="handlePreview(image)">
              <Icon icon="carbon:view" />
            </UiButton>
            <UiButton size="small" circle @click.stop="handleDownload(image)">
              <Icon icon="carbon:download" />
            </UiButton>
            <UiButton size="small" circle @click.stop="handleUpdateName(image)">
              <Icon icon="carbon:edit" />
            </UiButton>
            <UiButton size="small" circle @click.stop="copyLink(image)">
              <Icon icon="carbon:copy" />
            </UiButton>
            <UiButton size="small" circle @click.stop="copyMarkdown(image)" title="复制 Markdown">
              <Icon icon="carbon:code" />
            </UiButton>
            <UiButton size="small" circle class="delete-btn" @click.stop="handleDelete(image)">
              <Icon icon="carbon:trash-can" />
            </UiButton>
          </div>
        </div>

        <!-- 文件信息 -->
        <div class="card-footer">
          <span class="file-name" :title="image.fileName">{{ image.fileName }}</span>
          <span class="file-size">{{ formatFileSize(image.fileSize) }}</span>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="paginatedImages.length > 0" class="mt-4 flex justify-center">
      <ElPagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="filteredImages.length"
        layout="prev, pager, next"
        background
        size="small"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 设置对话框 -->
    <ElDialog
      v-model="showSettingsDialog"
      title="文件名设置"
      width="400px"
    >
      <div class="settings-content">
        <p class="text-sm text-gray-600 mb-3">
          设置上传文件的名称前缀，上传时会自动在前缀后添加 5 位随机字符。
        </p>
        <ElInput
          v-model="fileNamePrefix"
          placeholder="例如：img, photo, file"
          maxlength="20"
        >
          <template #prepend>前缀</template>
          <template #append>_xxxxx</template>
        </ElInput>
        <p class="text-xs text-gray-500 mt-2">
          示例：{{ fileNamePrefix || 'img' }}_a3b9f.jpg
        </p>
      </div>
      <template #footer>
        <UiButton size="small" @click="showSettingsDialog = false">取消</UiButton>
        <UiButton type="primary" size="small" @click="saveSettings">保存</UiButton>
      </template>
    </ElDialog>

    <!-- 预览对话框 -->
    <ElDialog
      v-model="showPreviewDialog"
      :title="previewImage?.fileName"
      width="80%"
      top="5vh"
    >
      <div v-if="previewImage" class="preview-container">
        <!-- 图片预览 -->
        <img
          v-if="previewImage.fileType === 'image'"
          :src="getFileUrl(previewImage.id, previewImage.shortId, previewImage.fileName)"
          :alt="previewImage.fileName"
          class="preview-media"
        />
        <!-- 视频预览 -->
        <video
          v-else-if="previewImage.fileType === 'video'"
          :src="getFileUrl(previewImage.id, previewImage.shortId, previewImage.fileName)"
          controls
          class="preview-media"
        />
        <!-- 音频预览 -->
        <audio
          v-else-if="previewImage.fileType === 'audio'"
          :src="getFileUrl(previewImage.id, previewImage.shortId, previewImage.fileName)"
          controls
          class="preview-audio"
        />
        <!-- 文件信息 -->
        <div v-else class="preview-file-info">
          <Icon icon="carbon:document" class="preview-file-icon" />
          <p class="text-gray-600">{{ previewImage.fileName }}</p>
          <p class="text-sm text-gray-500">{{ formatFileSize(previewImage.fileSize) }}</p>
        </div>
      </div>
      <template #footer>
        <UiButton size="small" @click="showPreviewDialog = false">关闭</UiButton>
        <UiButton type="primary" size="small" @click="handleDownload(previewImage!)">
          <Icon icon="carbon:download" class="mr-1" />
          下载
        </UiButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.images-title-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.mobile-menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  cursor: pointer;
  transition: all 150ms ease;
  flex-shrink: 0;
  font-size: 20px;
}

.mobile-menu-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  color: #9ca3af;
  gap: 6px;
}

.empty-icon,
.error-icon {
  font-size: 64px;
  color: #d1d5db;
}

.loading-icon {
  font-size: 64px;
  color: #9ca3af;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 文件网格 */
.images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 6px;
}

.image-card {
  position: relative;
  aspect-ratio: 16 / 9;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: visible;
  cursor: pointer;
  transition: all 0.2s;
}

.image-card > *:not(.image-overlay) {
  overflow: hidden;
  border-radius: 8px;
}

.image-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.image-card.is-selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

/* 收藏图标 */
.collect-icon {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.95);
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 16px;
  color: #9ca3af;
}

.collect-icon:hover {
  transform: scale(1.1);
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.collect-icon.liked {
  color: #f59e0b;
  background: white;
}

/* 选择框 */
.select-checkbox {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #6b7280;
  transition: all 0.2s;
}

.select-checkbox.checked {
  background: white;
  color: #3b82f6;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 预览区域 */
.image-preview,
.video-preview,
.file-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #f9fafb;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-preview {
  position: relative;
}

.video-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.play-icon {
  position: absolute;
  font-size: 48px;
  color: white;
  opacity: 0.9;
  pointer-events: none;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.file-preview {
  background: #f3f4f6;
}

.file-icon {
  font-size: 48px;
  color: #9ca3af;
}

/* 悬浮操作层 */
.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: 5;
}

.image-card:hover .image-overlay {
  opacity: 1;
  pointer-events: auto;
}

.overlay-buttons {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
}

.overlay-buttons :deep(.el-button) {
  background: white;
  border-color: white;
  width: 32px !important;
  height: 32px !important;
  padding: 0 !important;
  min-width: 32px;
  flex-shrink: 0;
}

.overlay-buttons :deep(.el-button .iconify) {
  font-size: 16px;
}

.overlay-buttons :deep(.el-button:hover) {
  background: #f3f4f6;
  border-color: #f3f4f6;
}

.overlay-buttons :deep(.delete-btn) {
  background: #fee2e2;
  border-color: #fee2e2;
  color: #dc2626;
}

.overlay-buttons :deep(.delete-btn:hover) {
  background: #fecaca;
  border-color: #fecaca;
  color: #b91c1c;
}

/* 底部信息 */
.card-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 8px 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  color: white;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
}

/* 工具类 */
.mr-1 {
  margin-right: 4px;
}

/* 响应式 */
@media (max-width: 768px) {
  .images-grid {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 6px;
  }
}

.settings-content {
  padding: 8px 0;
}

/* 预览对话框 */
.preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  background: #f9fafb;
  border-radius: 4px;
  padding: 4px;
}

.preview-media {
  max-width: 100%;
  max-height: 75vh;
  object-fit: contain;
  border-radius: 2px;
}

.preview-audio {
  width: 100%;
  max-width: 600px;
}

.preview-file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.preview-file-icon {
  font-size: 64px;
  color: #9ca3af;
}

/* 移动端优化 */
@media (max-width: 980px) {
  .mobile-menu-btn {
    display: flex;
  }

  .images-grid {
    grid-template-columns: 1fr !important;
    gap: 12px;
  }

  .image-card {
    max-width: 100%;
  }
}

@media (max-width: 640px) {
  .toolbar-actions {
    flex-wrap: wrap;
    gap: 8px;
  }

  .preview-media {
    max-height: 60vh;
  }
}
</style>
