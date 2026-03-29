export interface ServerConfig {
  url: string;
  token?: string;
}

export interface ServeConfig {
  port?: number;
  host?: string;
  token?: string;
}

export interface Config {
  memoryDir: string;
  dbPath: string;
  embedding: EmbeddingConfig;
  server?: ServerConfig;
  serve?: ServeConfig;
}

export interface EmbeddingConfig {
  provider: 'none' | 'openai' | 'ollama';
  model: string;
  baseUrl: string;
  dimensions: number;
  apiKey?: string;
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
  tags: string[];
  type: MemoryType;
  repository?: string;
  created: string;
  updated: string;
}

export interface Memory {
  id: string;
  title: string;
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
