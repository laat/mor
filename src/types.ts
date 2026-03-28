export interface Config {
  memoryDir: string;
  dbPath: string;
  embedding: EmbeddingConfig;
}

export interface EmbeddingConfig {
  provider: "none" | "openai" | "ollama";
  model: string;
  baseUrl: string;
  dimensions: number;
  apiKey?: string;
}

export interface FrontMatter {
  id: string;
  title: string;
  tags: string[];
  type: string;
  repository?: string;
  created: string;
  updated: string;
}

export interface Memory {
  id: string;
  title: string;
  tags: string[];
  type: string;
  repository?: string;
  created: string;
  updated: string;
  content: string;
  filePath: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: "uuid" | "filename" | "fts" | "vector";
}
