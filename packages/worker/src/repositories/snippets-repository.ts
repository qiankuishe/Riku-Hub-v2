import type { SnippetRecord, SnippetType, SnippetsRepositoryDeps } from '../types/snippets';

export class SnippetsRepository<TEnv> {
  constructor(
    private readonly env: TEnv,
    private readonly deps: SnippetsRepositoryDeps<TEnv>
  ) {}

  getAllSnippets(options?: { type?: SnippetType; query?: string }): Promise<SnippetRecord[]> {
    return this.deps.getAllSnippets(this.env, options);
  }

  getSnippetRecord(id: string): Promise<SnippetRecord | null> {
    return this.deps.getSnippetRecord(this.env, id);
  }

  saveSnippetRecord(snippet: SnippetRecord): Promise<SnippetRecord> {
    return this.deps.saveSnippetRecord(this.env, snippet);
  }

  createSnippetRecord(payload: Pick<SnippetRecord, 'type' | 'title' | 'content'>): Promise<SnippetRecord> {
    return this.deps.createSnippetRecord(this.env, payload);
  }

  deleteSnippetRecord(id: string): Promise<void> {
    return this.deps.deleteSnippetRecord(this.env, id);
  }

  isSnippetType(value: string | null | undefined): value is SnippetType {
    return this.deps.isSnippetType(value);
  }

  getDefaultSnippetTitle(type: SnippetType): string {
    return this.deps.getDefaultSnippetTitle(type);
  }

  getByteLength(value: string): number {
    return this.deps.getByteLength(value);
  }

  get maxImageSnippetBytes(): number {
    return this.deps.maxImageSnippetBytes;
  }
}

