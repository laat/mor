import type { Memory, MemoryType, SearchResult } from './types.js';

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
