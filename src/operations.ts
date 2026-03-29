import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Config, Memory, MemoryType, SearchResult } from './types.js';
import {
  openDb,
  upsertMemoryChecked,
  deleteMemoryFromDb,
  type DB,
} from './db.js';
import { syncIndex, searchAsync, hashContent } from './index.js';
import {
  createMemory,
  readMemory,
  deleteMemory,
  updateMemory,
  listMemoryFiles,
} from './memory.js';
import { resolveQuery } from './query.js';
import {
  createProvider,
  type EmbeddingProvider,
} from './embeddings/provider.js';

export interface Operations {
  search(query: string, limit?: number): Promise<SearchResult[]>;
  read(query: string): Promise<Memory | undefined>;
  add(opts: {
    title: string;
    content: string;
    tags?: string[];
    type?: MemoryType;
    repository?: string;
  }): Promise<Memory>;
  update(
    query: string,
    updates: {
      title?: string;
      content?: string;
      tags?: string[];
      type?: MemoryType;
    },
  ): Promise<Memory>;
  remove(query: string): Promise<{ title: string; id: string }>;
  list(): Promise<Memory[]>;
  push(): Promise<{ pushed: boolean; message: string }>;
  close(): void;
}

export class LocalOperations implements Operations {
  private config: Config;
  private db: DB;
  private provider: EmbeddingProvider;

  constructor(config: Config) {
    this.config = config;
    this.db = openDb(config);
    this.provider = createProvider(config.embedding);
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    return searchAsync(this.config, this.db, query, limit, this.provider);
  }

  async read(query: string): Promise<Memory | undefined> {
    return resolveQuery(this.config, this.db, query);
  }

  async add(opts: {
    title: string;
    content: string;
    tags?: string[];
    type?: MemoryType;
    repository?: string;
  }): Promise<Memory> {
    const mem = createMemory(this.config, opts);
    const raw = fs.readFileSync(mem.filePath, 'utf-8');
    upsertMemoryChecked(this.db, {
      id: mem.id,
      title: mem.title,
      tags: mem.tags,
      type: mem.type,
      repository: mem.repository,
      created: mem.created,
      updated: mem.updated,
      content: mem.content,
      filePath: mem.filePath,
      contentHash: hashContent(raw),
    });
    return mem;
  }

  async update(
    query: string,
    updates: {
      title?: string;
      content?: string;
      tags?: string[];
      type?: MemoryType;
    },
  ): Promise<Memory> {
    const mem = resolveQuery(this.config, this.db, query);
    if (!mem) throw new Error(`Memory not found: ${query}`);
    const updated = updateMemory(mem.filePath, updates);
    const raw = fs.readFileSync(updated.filePath, 'utf-8');
    upsertMemoryChecked(this.db, {
      id: updated.id,
      title: updated.title,
      tags: updated.tags,
      type: updated.type,
      repository: updated.repository,
      created: updated.created,
      updated: updated.updated,
      content: updated.content,
      filePath: updated.filePath,
      contentHash: hashContent(raw),
    });
    return updated;
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    const mem = resolveQuery(this.config, this.db, query);
    if (!mem) throw new Error(`Memory not found: ${query}`);
    deleteMemory(mem.filePath);
    deleteMemoryFromDb(this.db, mem.id);
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

  async push(): Promise<{ pushed: boolean; message: string }> {
    const dir = this.config.memoryDir;
    const git = (args: string[]) =>
      spawnSync('git', args, {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

    const status = git(['status', '--porcelain']);
    if (status.status !== 0) {
      throw new Error('Memory folder is not a git repository');
    }
    if (!status.stdout.trim()) {
      return { pushed: false, message: 'Nothing to push' };
    }

    const add = git(['add', '-A']);
    if (add.status !== 0)
      throw new Error(`git add failed: ${add.stderr.trim()}`);

    const commit = git(['commit', '-m', 'update memory']);
    if (commit.status !== 0)
      throw new Error(`git commit failed: ${commit.stderr.trim()}`);

    const push = git(['push']);
    if (push.status !== 0)
      throw new Error(`git push failed: ${push.stderr.trim()}`);

    return { pushed: true, message: 'Pushed memory changes' };
  }

  close(): void {
    this.db.close();
  }
}
