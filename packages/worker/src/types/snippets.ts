export type SnippetType = 'text' | 'code' | 'link' | 'image';

export interface SnippetRecord {
  id: string;
  type: SnippetType;
  title: string;
  content: string;
  isPinned: boolean;
  isLoginMapped: boolean;
  loginNodeLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetCreateInput {
  type?: string;
  title?: string;
  content?: string;
}

export interface SnippetUpdateInput {
  type?: string;
  title?: string;
  content?: string;
  isPinned?: boolean;
  isLoginMapped?: boolean;
}

export interface SnippetListQuery {
  type?: string | null;
  query?: string;
}

export interface SnippetsRepositoryDeps<TEnv> {
  getAllSnippets: (
    env: TEnv,
    options?: {
      type?: SnippetType;
      query?: string;
    }
  ) => Promise<SnippetRecord[]>;
  getSnippetRecord: (env: TEnv, id: string) => Promise<SnippetRecord | null>;
  saveSnippetRecord: (env: TEnv, snippet: SnippetRecord) => Promise<SnippetRecord>;
  createSnippetRecord: (
    env: TEnv,
    payload: Pick<SnippetRecord, 'type' | 'title' | 'content'>
  ) => Promise<SnippetRecord>;
  deleteSnippetRecord: (env: TEnv, id: string) => Promise<void>;
  isSnippetType: (value: string | null | undefined) => value is SnippetType;
  getDefaultSnippetTitle: (type: SnippetType) => string;
  getByteLength: (value: string) => number;
  maxImageSnippetBytes: number;
}
