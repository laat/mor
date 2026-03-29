import path from "node:path";
import type { Config, Memory, SearchResult } from "./types.js";
import { openDb, type DB } from "./db.js";
import { syncIndex, search as searchIndex, searchAsync } from "./index.js";
import { createMemory, readMemory, deleteMemory, updateMemory, listMemoryFiles } from "./memory.js";
import { resolveQuery } from "./query.js";

export interface Operations {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  read(query: string): Promise<Memory | undefined>;
  add(opts: { title: string; content: string; tags?: string[]; type?: string; repository?: string }): Promise<Memory>;
  update(query: string, updates: { title?: string; content?: string; tags?: string[]; type?: string }): Promise<Memory>;
  remove(query: string): Promise<{ title: string; id: string }>;
  list(): Promise<Memory[]>;
  close(): void;
}

export class LocalOperations implements Operations {
  private config: Config;
  private db: DB;

  constructor(config: Config) {
    this.config = config;
    this.db = openDb(config);
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    return searchAsync(this.config, this.db, query, limit);
  }

  async read(query: string): Promise<Memory | undefined> {
    return resolveQuery(this.config, this.db, query);
  }

  async add(opts: { title: string; content: string; tags?: string[]; type?: string; repository?: string }): Promise<Memory> {
    const mem = createMemory(this.config, opts);
    syncIndex(this.config, this.db);
    return mem;
  }

  async update(query: string, updates: { title?: string; content?: string; tags?: string[]; type?: string }): Promise<Memory> {
    const mem = resolveQuery(this.config, this.db, query);
    if (!mem) throw new Error(`Memory not found: ${query}`);
    const updated = updateMemory(mem.filePath, updates);
    syncIndex(this.config, this.db);
    return updated;
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    const mem = resolveQuery(this.config, this.db, query);
    if (!mem) throw new Error(`Memory not found: ${query}`);
    deleteMemory(mem.filePath);
    syncIndex(this.config, this.db);
    return { title: mem.title, id: mem.id };
  }

  async list(): Promise<Memory[]> {
    syncIndex(this.config, this.db);
    const files = listMemoryFiles(this.config);
    const memories: Memory[] = [];
    for (const filePath of files) {
      try {
        memories.push(readMemory(filePath));
      } catch {
        // skip unparseable files
      }
    }
    return memories;
  }

  close(): void {
    this.db.close();
  }
}
