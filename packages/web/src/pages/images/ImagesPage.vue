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
  <div class="images-page">
    <!-- 顶部工具栏 -->
    <header class="images-header">
      <div class="header-left">
        <h1 class="title" @click="refresh">图床管理</h1>
        <span class="stats">{{ total }} 个文件</span>
      </div>

      <div class="header-center">
        <ElInput
          v-model="searchQuery"
          placeholder="搜索文件名或 ID..."
          clearable
          class="search-input"
          @input="() => handlePageChange(1)"
        >
          <template #prefix>
            <Icon icon="carbon:search" />
          </template>
        </ElInput>
      </div>

      <div class="header-right">
        <ElButton type="primary" :loading="uploading" @click="handleUploadClick">
          <Icon icon="carbon:upload" class="mr-1" />
          上传文件
        </ElButton>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="*/*"
          style="display: none"
          @change="onFileSelect"
        />

        <!-- 文件类型 -->
        <ElDropdown @command="switchFileType">
          <ElButton>
            <Icon :icon="fileTypeIcon" />
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
          <ElButton>
            <Icon :icon="sortIcon" />
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
          <ElButton>
            <Icon :icon="filterIcon" />
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
          <ElButton :disabled="selectedImages.length === 0">
            <Icon icon="carbon:task" />
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
          <ElButton>
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
    </header>

    <!-- 文件网格 -->
    <main class="images-content">
      <div v-if="loading" class="loading-state">
        <Icon icon="carbon:renew" class="loading-icon" />
        <p>加载中...</p>
      </div>

      <div v-else-if="error" class="error-state">
        <Icon icon="carbon:warning" class="error-icon" />
        <p>{{ error }}</p>
        <ElButton @click="refresh">重试</ElButton>
      </div>

      <div v-else-if="paginatedImages.length === 0" class="empty-state">
        <Icon icon="carbon:image" class="empty-icon" />
        <p>暂无文件</p>
        <ElButton type="primary" @click="handleUploadClick">上传文件</ElButton>
      </div>

      <div v-else class="images-grid">
        <div
          v-for="image in paginatedImages"
          :key="image.id"
          class="image-card"
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
              <ElButton size="small" @click.stop="handleUpdateName(image)">
                <Icon icon="carbon:edit" />
              </ElButton>
              <ElButton size="small" type="primary" @click.stop="copyLink(image)">
                <Icon icon="carbon:copy" />
              </ElButton>
              <ElButton size="small" type="danger" @click.stop="handleDelete(image)">
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
    </main>

    <!-- 分页 -->
    <footer v-if="paginatedImages.length > 0" class="images-footer">
      <ElPagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="filteredImages.length"
        layout="prev, pager, next"
        background
        @current-change="handlePageChange"
      />
    </footer>
  </div>
</template>

<style scoped>
.images-page {
  min-height: 100vh;
  background: linear-gradient(90deg, #ffd7e4 0%, #c8f1ff 100%);
  padding: 0;
}

.images-header {
  position: sticky;
  top: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 1.5rem;
  font-weight: bold;
  margin: 0;
  cursor: pointer;
  transition: color 0.3s;
}

.title:hover {
  color: #B39DDB;
}

.stats {
  font-size: 0.9rem;
  color: #666;
  background: rgba(255, 255, 255, 0.9);
  padding: 4px 12px;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-center {
  flex: 1;
  max-width: 400px;
}

.search-input {
  width: 100%;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.images-content {
  padding: 24px;
  min-height: calc(100vh - 200px);
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: 16px;
}

.loading-icon,
.error-icon,
.empty-icon {
  font-size: 48px;
  color: #999;
}

.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.images-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}

.image-card {
  position: relative;
  aspect-ratio: 4 / 3;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  transition: transform 0.3s, box-shadow 0.3s;
  cursor: pointer;
}

.image-card:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.image-card.is-selected {
  box-shadow: 0 0 0 3px #409EFF;
}

.collect-icon {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 18px;
  color: #999;
}

.collect-icon:hover {
  transform: scale(1.1);
  background: white;
}

.collect-icon.liked {
  color: #FFD700;
}

.select-checkbox {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 4px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 18px;
  color: #409EFF;
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
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, #8EC5FC 0%, #E0C3FC 100%);
}

.file-preview {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.file-icon {
  font-size: 64px;
  color: white;
}

.audio-player {
  width: 100%;
  height: 42px;
  border-radius: 21px;
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
  background: rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.image-card:hover .image-overlay {
  opacity: 1;
  pointer-events: auto;
}

.overlay-buttons {
  display: flex;
  gap: 8px;
}

.card-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 12px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.images-footer {
  display: flex;
  justify-content: center;
  padding: 24px;
}

.mr-1 {
  margin-right: 4px;
}

.is-active {
  background: rgba(64, 158, 255, 0.1);
  color: #409EFF;
}

@media (max-width: 768px) {
  .images-header {
    flex-wrap: wrap;
    padding: 12px 16px;
  }

  .header-center {
    order: 3;
    width: 100%;
    max-width: none;
    margin-top: 12px;
  }

  .images-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .images-content {
    padding: 16px;
  }
}
</style>
