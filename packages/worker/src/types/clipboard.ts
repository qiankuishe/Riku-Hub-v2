export type ClipboardItemType = 'text' | 'code' | 'link' | 'image';

export interface ClipboardItemRecord {
  id: string;
  type: ClipboardItemType;
  content: string;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

