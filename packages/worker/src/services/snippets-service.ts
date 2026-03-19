import { SnippetsRepository } from '../repositories/snippets-repository';
import type { SnippetCreateInput, SnippetListQuery, SnippetRecord, SnippetUpdateInput } from '../types/snippets';

const LOGIN_NODE_LABELS = [
  'NODE_ALPHA_01',
  'NODE_BETA_02',
  'NODE_GAMMA_03',
  'NODE_DELTA_04',
  'NODE_EPSILON_05',
  'NODE_ZETA_06',
  'NODE_ETA_07',
  'NODE_THETA_08',
  'NODE_IOTA_09'
] as const;

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
      ...(await this.resolveLoginMapState(snippet, input)),
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

  private async resolveLoginMapState(
    snippet: SnippetRecord,
    input: SnippetUpdateInput
  ): Promise<Pick<SnippetRecord, 'isLoginMapped' | 'loginNodeLabel'>> {
    const shouldMap = typeof input.isLoginMapped === 'boolean' ? input.isLoginMapped : snippet.isLoginMapped;
    if (!shouldMap) {
      return {
        isLoginMapped: false,
        loginNodeLabel: null
      };
    }

    if (snippet.isLoginMapped && snippet.loginNodeLabel) {
      return {
        isLoginMapped: true,
        loginNodeLabel: snippet.loginNodeLabel
      };
    }

    const allSnippets = await this.repository.getAllSnippets();
    const usedLabels = new Set(
      allSnippets
        .filter((entry) => entry.id !== snippet.id && entry.isLoginMapped && Boolean(entry.loginNodeLabel))
        .map((entry) => entry.loginNodeLabel as string)
    );

    if (usedLabels.size >= LOGIN_NODE_LABELS.length) {
      throw new SnippetsHttpError(400, '最多只能映射9个片段到登录页');
    }

    const availableLabel = LOGIN_NODE_LABELS.find((label) => !usedLabels.has(label));
    if (!availableLabel) {
      throw new SnippetsHttpError(400, '没有可用的登录节点标签');
    }

    return {
      isLoginMapped: true,
      loginNodeLabel: availableLabel
    };
  }
}
