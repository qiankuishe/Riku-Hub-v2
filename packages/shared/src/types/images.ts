/**
 * 图床功能类型定义
 */

export type FileType = 'image' | 'video' | 'audio' | 'document';
export type ListType = 'Block' | 'White' | null;
export type SortOption = 'dateDesc' | 'nameAsc' | 'sizeDesc';
export type FilterOption = 'all' | 'favorites' | 'blocked' | 'unblocked' | 'adult';

export interface ImageRecord {
  id: string;
  shortId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  fileType: FileType;
  telegramFileId: string;
  isLiked: boolean;
  listType: ListType;
  label: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImageListParams {
  cursor?: string;
  limit?: number;
  fileType?: FileType | 'all';
  sortBy?: SortOption;
  filter?: FilterOption;
  search?: string;
}

export interface ImageListResponse {
  images: ImageRecord[];
  cursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface CreateImageData {
  userId: string;
  fileName: string;
  fileSize: number;
  fileType: FileType;
  telegramFileId: string;
  label?: string;
}

export interface UpdateImageData {
  fileName?: string;
  isLiked?: boolean;
  listType?: ListType;
  label?: string;
}

export interface UploadResponse {
  image: ImageRecord;
}
