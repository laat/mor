export interface ServerConfig {
  url: string;
  token?: string;
}

export interface ServeConfig {
  port?: number;
  host?: string;
  token?: string;
  mcp?: boolean;
}

export interface Config {
  memoryDir: string;
  dbPath: string;
  autosync?: boolean;
  embedding?: EmbeddingConfig;
  server?: ServerConfig;
  serve?: ServeConfig;
}

export interface EmbeddingConfig {
  provider: 'none' | 'openai' | 'azure-openai' | 'ollama';
  model: string;
  baseUrl?: string;
  dimensions: number;
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
}

export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
  'knowledge',
  'snippet',
  'file',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface FrontMatter {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  type: MemoryType;
  repository?: string;
  created: string;
  updated: string;
}

export interface Memory {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  type: MemoryType;
  repository?: string;
  created: string;
  updated: string;
  content: string;
  filePath: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: 'uuid' | 'filename' | 'fts' | 'vector';
}

export interface MemoryFilter {
  type?: string;
  tag?: string;
  repo?: string;
  ext?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface Operations {
  search(
    query: string,
    limit?: number,
    filter?: MemoryFilter,
    offset?: number,
  ): Promise<Paginated<SearchResult>>;
  read(query: string): Promise<Memory | undefined>;
  add(opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: MemoryType;
    repository?: string;
  }): Promise<Memory>;
  update(
    query: string,
    updates: {
      title?: string;
      description?: string;
      content?: string;
      tags?: string[];
      type?: MemoryType;
    },
  ): Promise<Memory>;
  remove(query: string): Promise<{ title: string; id: string }>;
  grep(
    pattern: string,
    limit?: number,
    ignoreCase?: boolean,
    filter?: MemoryFilter,
    offset?: number,
  ): Promise<Paginated<Memory>>;
  list(
    filter?: MemoryFilter,
    limit?: number,
    offset?: number,
  ): Promise<Paginated<Memory>>;
  reindex(): Promise<{ count: number }>;
  sync(commitMessage?: string): Promise<{ message: string }>;
  close(): void;
}
