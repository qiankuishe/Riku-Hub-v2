<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { ElButton, ElInput, ElDropdown, ElDropdownMenu, ElDropdownItem, ElPagination, ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useImageList } from './composables/useImageList';
import { useImageUpload } from './composables/useImageUpload';
import { useImageOperations } from './composables/useImageOperations';
import { imagesApi } from '../../api/images';
import type { ImageRecord, FileType } from '@riku-hub/shared/types/images';

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
  batchCopyLinks,
  batchDownload,
  updateListType,
  batchUpdateListType
} = useImageOperations();

// Refs
const fileInput = ref<HTMLInputElement | null>(null);

// 文件类型配置
const fileTypeConfig = {
  image: { name: '图片', icon: 'carbon:image', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'ico'] },
  video: { name: '视频', icon: 'carbon:video', exts: ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv'] },
  audio: { name: '音频', icon: 'carbon:music', exts: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'] },
  document: { name: '文件', icon: 'carbon:document', exts: [] }
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

// 方法
function handleUploadClick() {
  fileInput.value?.click();
}

async function onFileSelect(event: Event) {
  const newImages = await handleFileSelect(event);
  if (newImages.length > 0) {
    await refresh();
  }
}

async function handleDelete(image: ImageRecord) {
  const success = await deleteImage(image);
  if (success) {
    await refresh();
  }
}

async function handleToggleLike(image: ImageRecord) {
  const updated = await toggleLike(image);
  if (updated) {
    // 更新本地数据
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

async function handleBatchOperation(command: string) {
  if (selectedImages.value.length === 0) {
    ElMessage.warning('请先选择文件');
    return;
  }

  let count = 0;
  switch (command) {
    case 'copy':
      await batchCopyLinks(selectedImages.value);
      break;
    case 'delete':
      count = await batchDelete(selectedImages.value);
      if (count > 0) {
        clearSelection();
        await refresh();
      }
      break;
    case 'download':
      batchDownload(selectedImages.value);
      break;
    case 'block':
      count = await batchUpdateListType(selectedImages.value, 'Block');
      if (count > 0) {
        clearSelection();
        await refresh();
      }
      break;
    case 'unblock':
      count = await batchUpdateListType(selectedImages.value, 'White');
      if (count > 0) {
        clearSelection();
        await refresh();
      }
      break;
  }
}

function getFileUrl(id: string): string {
  return imagesApi.getFileUrl(id);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

// 生命周期
onMounted(() => {
  loadImages();
});
</script>

<template>
  <div class="card">
    <!-- 顶部标题和操作 -->
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-gray-900">图床</h2>
        <p class="text-sm text-gray-500">管理你的图片、视频、音频和文件。{{ total }} 个文件</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <ElButton type="primary" size="small" :loading="uploading" @click="handleUploadClick">
          <Icon icon="carbon:upload" class="mr-1" />
          上传文件
        </ElButton>
        <ElButton size="small" :loading="loading" @click="refresh">
          <Icon icon="carbon:renew" class="mr-1" />
          刷新
        </ElButton>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="*/*"
          style="display: none"
          @change="onFileSelect"
        />
      </div>
    </div>

    <!-- 搜索和筛选工具栏 -->
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <ElInput
        v-model="searchQuery"
        clearable
        placeholder="搜索文件名或 ID..."
        style="width: 240px"
        @input="() => handlePageChange(1)"
      >
        <template #prefix>
          <Icon icon="carbon:search" />
        </template>
      </ElInput>

      <div class="flex flex-wrap items-center gap-2">
        <!-- 文件类型 -->
        <ElDropdown @command="switchFileType">
          <ElButton size="small">
            <Icon :icon="fileTypeIcon" class="mr-1" />
            文件类型
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="all" :class="{ 'is-active': fileType === 'all' }">
                <Icon icon="carbon:folder-open" class="mr-1" />
                全部 ({{ total }})
              </ElDropdownItem>
              <ElDropdownItem command="image" :class="{ 'is-active': fileType === 'image' }">
                <Icon icon="carbon:image" class="mr-1" />
                图片 ({{ fileTypeStats.image }})
              </ElDropdownItem>
              <ElDropdownItem command="video" :class="{ 'is-active': fileType === 'video' }">
                <Icon icon="carbon:video" class="mr-1" />
                视频 ({{ fileTypeStats.video }})
              </ElDropdownItem>
              <ElDropdownItem command="audio" :class="{ 'is-active': fileType === 'audio' }">
                <Icon icon="carbon:music" class="mr-1" />
                音频 ({{ fileTypeStats.audio }})
              </ElDropdownItem>
              <ElDropdownItem command="document" :class="{ 'is-active': fileType === 'document' }">
                <Icon icon="carbon:document" class="mr-1" />
                文件 ({{ fileTypeStats.document }})
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 排序 -->
        <ElDropdown @command="switchSort">
          <ElButton size="small">
            <Icon :icon="sortIcon" class="mr-1" />
            排序
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="dateDesc" :class="{ 'is-active': sortOption === 'dateDesc' }">
                <Icon icon="carbon:sort-descending" class="mr-1" />
                按时间倒序
              </ElDropdownItem>
              <ElDropdownItem command="nameAsc" :class="{ 'is-active': sortOption === 'nameAsc' }">
                <Icon icon="carbon:sort-ascending" class="mr-1" />
                按名称升序
              </ElDropdownItem>
              <ElDropdownItem command="sizeDesc" :class="{ 'is-active': sortOption === 'sizeDesc' }">
                <Icon icon="carbon:sort-descending" class="mr-1" />
                按大小倒序
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 筛选 -->
        <ElDropdown @command="switchFilter">
          <ElButton size="small">
            <Icon :icon="filterIcon" class="mr-1" />
            筛选
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="all" :class="{ 'is-active': filterOption === 'all' }">
                <Icon icon="carbon:filter" class="mr-1" />
                全部
              </ElDropdownItem>
              <ElDropdownItem command="favorites" :class="{ 'is-active': filterOption === 'favorites' }">
                <Icon icon="carbon:star-filled" class="mr-1" />
                收藏
              </ElDropdownItem>
              <ElDropdownItem command="blocked" :class="{ 'is-active': filterOption === 'blocked' }">
                <Icon icon="carbon:locked" class="mr-1" />
                黑名单
              </ElDropdownItem>
              <ElDropdownItem command="unblocked" :class="{ 'is-active': filterOption === 'unblocked' }">
                <Icon icon="carbon:unlocked" class="mr-1" />
                白名单
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 批量操作 -->
        <ElDropdown @command="handleBatchOperation">
          <ElButton size="small" :disabled="selectedImages.length === 0">
            <Icon icon="carbon:task" class="mr-1" />
            批量操作
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="copy">
                <Icon icon="carbon:link" class="mr-1" />
                批量复制链接
              </ElDropdownItem>
              <ElDropdownItem command="delete">
                <Icon icon="carbon:trash-can" class="mr-1" />
                批量删除
              </ElDropdownItem>
              <ElDropdownItem command="download">
                <Icon icon="carbon:download" class="mr-1" />
                批量下载
              </ElDropdownItem>
              <ElDropdownItem command="block">
                <Icon icon="carbon:locked" class="mr-1" />
                加入黑名单
              </ElDropdownItem>
              <ElDropdownItem command="unblock">
                <Icon icon="carbon:unlocked" class="mr-1" />
                加入白名单
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>

        <!-- 工具箱 -->
        <ElDropdown>
          <ElButton size="small">
            <Icon icon="carbon:tools" />
          </ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem @click="selectAllInPage">
                <Icon icon="carbon:checkbox-checked" class="mr-1" />
                全选当前页
              </ElDropdownItem>
              <ElDropdownItem @click="clearSelection">
                <Icon icon="carbon:checkbox" class="mr-1" />
                清空选择
              </ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
      </div>
    </div>

    <!-- 文件网格 -->
    <div v-if="loading" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
      加载中...
    </div>

    <div v-else-if="error" class="rounded-lg border border-dashed border-red-300 bg-red-50 px-4 py-8 text-center">
      <p class="text-sm text-red-600 mb-3">{{ error }}</p>
      <ElButton size="small" @click="refresh">重试</ElButton>
    </div>

    <div v-else-if="paginatedImages.length === 0" class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
      <p class="text-sm text-gray-500 mb-3">暂无文件</p>
      <ElButton type="primary" size="small" @click="handleUploadClick">上传文件</ElButton>
    </div>

    <div v-else class="images-grid">
      <div
        v-for="image in paginatedImages"
        :key="image.id"
        class="content-card image-card"
        :class="{ 'is-selected': selectedFiles.has(image.id) }"
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
        <button
          class="select-checkbox"
          @click.stop="toggleSelect(image.id)"
        >
          <Icon :icon="selectedFiles.has(image.id) ? 'carbon:checkbox-checked' : 'carbon:checkbox'" />
        </button>

        <!-- 图片预览 -->
        <div v-if="image.fileType === 'image'" class="image-preview">
          <img :src="getFileUrl(image.id)" :alt="image.fileName" />
        </div>

        <!-- 视频预览 -->
        <div v-else-if="image.fileType === 'video'" class="video-preview">
          <video :src="getFileUrl(image.id)" controls />
        </div>

        <!-- 音频预览 -->
        <div v-else-if="image.fileType === 'audio'" class="audio-preview">
          <Icon icon="carbon:music" class="file-icon" />
          <audio :src="getFileUrl(image.id)" controls class="audio-player" />
        </div>

        <!-- 文件预览 -->
        <div v-else class="file-preview">
          <Icon icon="carbon:document" class="file-icon" />
        </div>

        <!-- 操作按钮 -->
        <div class="image-overlay">
          <div class="overlay-buttons">
            <ElButton size="small" text @click.stop="handleUpdateName(image)">
              <Icon icon="carbon:edit" />
            </ElButton>
            <ElButton size="small" text @click.stop="copyLink(image)">
              <Icon icon="carbon:copy" />
            </ElButton>
            <ElButton size="small" text type="danger" @click.stop="handleDelete(image)">
              <Icon icon="carbon:trash-can" />
            </ElButton>
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
        small
        @current-change="handlePageChange"
      />
    </div>
  </div>
</template>

<style scoped>
.images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.image-card {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s;
}

.image-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.image-card.is-selected {
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.16);
}

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
  transition: all 0.15s;
  font-size: 16px;
  color: #6b7280;
}

.collect-icon:hover {
  transform: scale(1.1);
  background: white;
}

.collect-icon.liked {
  color: #f59e0b;
}

.select-checkbox {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.95);
  border: none;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 16px;
  color: #111827;
}

.select-checkbox:hover {
  background: white;
  transform: scale(1.1);
}

.image-preview,
.video-preview,
.audio-preview,
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

.video-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audio-preview {
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #f3f4f6;
}

.file-preview {
  background: #e5e7eb;
}

.file-icon {
  font-size: 48px;
  color: #6b7280;
}

.audio-player {
  width: 100%;
  height: 36px;
}

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
  transition: opacity 0.15s;
  pointer-events: none;
}

.image-card:hover .image-overlay {
  opacity: 1;
  pointer-events: auto;
}

.overlay-buttons {
  display: flex;
  gap: 6px;
}

.overlay-buttons :deep(.el-button) {
  background: white;
  border-color: white;
  color: #111827;
}

.overlay-buttons :deep(.el-button:hover) {
  background: #f3f4f6;
  border-color: #f3f4f6;
}

.overlay-buttons :deep(.el-button.is-text) {
  background: rgba(255, 255, 255, 0.95);
}

.card-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
}

.mr-1 {
  margin-right: 4px;
}

.is-active {
  background: rgba(0, 0, 0, 0.04);
  color: #111827;
  font-weight: 500;
}

@media (max-width: 768px) {
  .images-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
</style>
