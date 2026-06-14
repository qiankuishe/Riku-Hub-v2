/**
 * 图片列表逻辑
 */

import { ref, computed, watch, onMounted } from 'vue';
import { imagesApi } from '../../../api/images';
import type { ImageRecord, FileType, SortOption, FilterOption } from '@riku-hub/shared/types/images';

export function useImageList() {
  const images = ref<ImageRecord[]>([]);
  const loading = ref(false);
  const error = ref('');
  const total = ref(0);

  // 筛选和排序
  const fileType = ref<FileType | 'all'>('image');
  const sortOption = ref<SortOption>('dateDesc');
  const filterOption = ref<FilterOption>('all');
  const searchInput = ref(''); // 用户输入
  const searchQuery = ref(''); // 实际搜索值（防抖后）

  // 分页 - 从 URL 读取初始页码
  const urlParams = new URLSearchParams(window.location.search);
  const initialPage = parseInt(urlParams.get('page') || '1', 10);
  const currentPage = ref(initialPage > 0 ? initialPage : 1);
  const pageSize = ref(30);

  // 选中的文件
  const selectedFiles = ref<Set<string>>(new Set());

  // 防抖定时器
  let searchDebounceTimer: number | undefined;

  // 监听搜索输入，防抖 300ms
  watch(searchInput, (value) => {
    if (searchDebounceTimer) {
      window.clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = window.setTimeout(() => {
      searchQuery.value = value;
      currentPage.value = 1;
    }, 300);
  });

  // 监听页码变化，同步到 URL
  watch(currentPage, (page) => {
    const url = new URL(window.location.href);
    if (page === 1) {
      url.searchParams.delete('page');
    } else {
      url.searchParams.set('page', String(page));
    }
    window.history.replaceState({}, '', url);
  });

  /**
   * 加载图片列表
   */
  async function loadImages() {
    loading.value = true;
    error.value = '';

    try {
      const response = await imagesApi.getList({
        limit: 1000, // 先加载所有，前端分页
        fileType: fileType.value,
        sortBy: sortOption.value,
        filter: filterOption.value,
        search: searchQuery.value
      });

      images.value = response.images;
      total.value = response.total;
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载失败';
      images.value = [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 筛选后的图片
   */
  const filteredImages = computed(() => {
    let result = [...images.value];

    // 搜索
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase();
      result = result.filter(img =>
        img.fileName.toLowerCase().includes(query) ||
        img.id.toLowerCase().includes(query)
      );
    }

    return result;
  });

  /**
   * 当前页的图片
   */
  const paginatedImages = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    const end = start + pageSize.value;
    return filteredImages.value.slice(start, end);
  });

  /**
   * 文件类型统计
   */
  const fileTypeStats = computed(() => {
    const stats = {
      image: 0,
      video: 0,
      audio: 0,
      document: 0
    };

    images.value.forEach(img => {
      stats[img.fileType]++;
    });

    return stats;
  });

  /**
   * 切换文件类型
   */
  function switchFileType(type: FileType | 'all') {
    fileType.value = type;
    currentPage.value = 1;
    selectedFiles.value.clear();
    loadImages();
  }

  /**
   * 切换排序
   */
  function switchSort(sort: SortOption) {
    sortOption.value = sort;
    loadImages();
  }

  /**
   * 切换筛选
   */
  function switchFilter(filter: FilterOption) {
    filterOption.value = filter;
    currentPage.value = 1;
    loadImages();
  }

  /**
   * 搜索
   */
  function search(query: string) {
    searchQuery.value = query;
    currentPage.value = 1;
  }

  /**
   * 切换选中状态
   */
  function toggleSelect(id: string) {
    if (selectedFiles.value.has(id)) {
      selectedFiles.value.delete(id);
    } else {
      selectedFiles.value.add(id);
    }
  }

  /**
   * 全选当前页
   */
  function selectAllInPage() {
    const allSelected = paginatedImages.value.every(img => selectedFiles.value.has(img.id));
    
    if (allSelected) {
      // 取消全选
      paginatedImages.value.forEach(img => selectedFiles.value.delete(img.id));
    } else {
      // 全选
      paginatedImages.value.forEach(img => selectedFiles.value.add(img.id));
    }
  }

  /**
   * 清空选中
   */
  function clearSelection() {
    selectedFiles.value.clear();
  }

  /**
   * 获取选中的图片
   */
  const selectedImages = computed(() => {
    return images.value.filter(img => selectedFiles.value.has(img.id));
  });

  /**
   * 页码变化
   */
  function handlePageChange(page: number) {
    currentPage.value = page;
  }

  /**
   * 刷新列表
   */
  function refresh() {
    loadImages();
  }

  return {
    // 状态
    images,
    loading,
    error,
    total,
    fileType,
    sortOption,
    filterOption,
    searchInput,
    searchQuery,
    currentPage,
    pageSize,
    selectedFiles,

    // 计算属性
    filteredImages,
    paginatedImages,
    fileTypeStats,
    selectedImages,

    // 方法
    loadImages,
    switchFileType,
    switchSort,
    switchFilter,
    search,
    toggleSelect,
    selectAllInPage,
    clearSelection,
    handlePageChange,
    refresh
  };
}
