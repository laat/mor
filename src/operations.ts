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
  notesDir: string;
  dbPath: string;
  autosync?: boolean;
  threshold?: number;
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

export const NOTE_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
  'knowledge',
  'snippet',
  'file',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export interface FrontMatter {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  type: NoteType;
  repository?: string;
  created: string;
  updated: string;
}

export interface Note {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  type: NoteType;
  repository?: string;
  created: string;
  updated: string;
  content: string;
  filePath: string;
}

export interface SearchResult {
  note: Note;
  score: number;
  matchType: 'uuid' | 'filename' | 'fts' | 'vector';
}

export interface NoteFilter {
  type?: string;
  tag?: string[];
  repo?: string;
  ext?: string;
}

export interface GrepOptions {
  limit?: number;
  ignoreCase?: boolean;
  filter?: NoteFilter;
  offset?: number;
  regex?: boolean;
}

export type ScoringMode = 'fts' | 'hybrid';

export interface Paginated<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface SearchPage extends Paginated<SearchResult> {
  scoring: ScoringMode;
}

export interface Operations {
  search(
    query: string,
    limit?: number,
    filter?: NoteFilter,
    offset?: number,
  ): Promise<SearchPage>;
  read(query: string): Promise<Note | undefined>;
  add(opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: NoteType;
    repository?: string;
  }): Promise<Note>;
  update(
    query: string,
    updates: {
      title?: string;
      description?: string;
      content?: string;
      tags?: string[];
      type?: NoteType;
    },
  ): Promise<Note>;
  remove(query: string): Promise<{ title: string; id: string }>;
  grep(pattern: string, opts?: GrepOptions): Promise<Paginated<Note>>;
  list(
    filter?: NoteFilter,
    limit?: number,
    offset?: number,
  ): Promise<Paginated<Note>>;
  getLinks(noteId: string): Promise<{
    forward: Array<{ id: string; title: string }>;
    back: Array<{ id: string; title: string }>;
  }>;
  reindex(): Promise<{
    count: number;
    embedding?: {
      provider: string;
      model: string;
      dimensions: number;
      baseUrl?: string;
    };
  }>;
  patch(query: string, oldStr: string, newStr: string): Promise<Note>;
  sync(commitMessage?: string): Promise<{ message: string }>;
  close(): void | Promise<void>;
}
