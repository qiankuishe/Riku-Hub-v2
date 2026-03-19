import { SnippetsRepository } from '../repositories/snippets-repository';
import type { SnippetCreateInput, SnippetListQuery, SnippetRecord, SnippetUpdateInput } from '../types/snippets';

export class SnippetsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class SnippetsService<TEnv> {
  constructor(private readonly repository: SnippetsRepository<TEnv>) {}

  async listSnippets(query: SnippetListQuery): Promise<{ snippets: SnippetRecord[] }> {
    const snippets = await this.repository.getAllSnippets({
      type: this.repository.isSnippetType(query.type) ? query.type : undefined,
      query: query.query?.trim()
    });
    return { snippets };
  }

  async createSnippet(input: SnippetCreateInput): Promise<{ snippet: SnippetRecord }> {
    if (!this.repository.isSnippetType(input.type)) {
      throw new SnippetsHttpError(400, '片段类型无效');
    }

    const title = input.title?.trim() || this.repository.getDefaultSnippetTitle(input.type);
    const content = input.content ?? '';
    this.assertImageSize(input.type, content);

    const snippet = await this.repository.createSnippetRecord({
      type: input.type,
      title,
      content
    });
    return { snippet };
  }

  async updateSnippet(id: string, input: SnippetUpdateInput): Promise<{ snippet: SnippetRecord }> {
    const snippet = await this.repository.getSnippetRecord(id);
    if (!snippet) {
      throw new SnippetsHttpError(404, '片段不存在');
    }

    const nextType = this.repository.isSnippetType(input.type) ? input.type : snippet.type;
    const nextContent = typeof input.content === 'string' ? input.content : snippet.content;
    this.assertImageSize(nextType, nextContent);

    const updated = await this.repository.saveSnippetRecord({
      ...snippet,
      type: nextType,
      title: input.title?.trim() || snippet.title,
      content: nextContent,
      isPinned: typeof input.isPinned === 'boolean' ? input.isPinned : snippet.isPinned,
      updatedAt: new Date().toISOString()
    });

    return { snippet: updated };
  }

  async deleteSnippet(id: string): Promise<{ success: true }> {
    const snippet = await this.repository.getSnippetRecord(id);
    if (!snippet) {
      throw new SnippetsHttpError(404, '片段不存在');
    }

    await this.repository.deleteSnippetRecord(snippet.id);
    return { success: true };
  }

  private assertImageSize(type: string, content: string): void {
    if (type === 'image' && this.repository.getByteLength(content) > this.repository.maxImageSnippetBytes) {
      throw new SnippetsHttpError(400, '图片片段过大，请使用更小的图片或压缩后再试');
    }
  }
}

