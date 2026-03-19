import type { SnippetType } from '../types/snippets';

export function isSnippetType(value: string | null | undefined): value is SnippetType {
  return value === 'text' || value === 'code' || value === 'link' || value === 'image';
}

export function getDefaultSnippetTitle(type: SnippetType): string {
  const map: Record<SnippetType, string> = {
    text: '文本片段',
    code: '代码片段',
    link: '链接片段',
    image: '图片片段'
  };
  return map[type];
}

export function getByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

