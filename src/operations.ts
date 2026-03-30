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

export interface Operations {
  search(query: string, limit?: number): Promise<SearchResult[]>;
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
  ): Promise<Memory[]>;
  list(): Promise<Memory[]>;
  reindex(): Promise<{ count: number }>;
  sync(): Promise<{ message: string }>;
  close(): void;
}
