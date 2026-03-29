import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  deleteMemoryFromDb,
  grepMemories,
  openDb,
  upsertMemoryChecked,
  type DB,
} from './db.js';
import {
  createProvider,
  type EmbeddingProvider,
} from './embeddings/provider.js';
import {
  computeAndStoreEmbedding,
  hashContent,
  reindex as rebuildIndex,
  searchAsync,
  syncIndex,
} from './index.js';
import {
  createMemory,
  deleteMemory,
  listMemoryFiles,
  readMemory,
  updateMemory,
} from './memory.js';
import { resolveQuery } from './query.js';
import type { Config, Memory, MemoryType, SearchResult } from './types.js';

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
    description?: string;
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
    await computeAndStoreEmbedding(this.db, this.provider, mem);
    return mem;
  }

  async update(
    query: string,
    updates: {
      title?: string;
      description?: string;
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
    await computeAndStoreEmbedding(this.db, this.provider, updated);
    return updated;
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    const mem = resolveQuery(this.config, this.db, query);
    if (!mem) throw new Error(`Memory not found: ${query}`);
    deleteMemory(mem.filePath);
    deleteMemoryFromDb(this.db, mem.id);
    return { title: mem.title, id: mem.id };
  }

  async grep(
    pattern: string,
    limit = 20,
    ignoreCase = false,
  ): Promise<Memory[]> {
    syncIndex(this.config, this.db);
    const rows = grepMemories(this.db, pattern, limit, ignoreCase);
    const memories: Memory[] = [];
    for (const row of rows) {
      try {
        memories.push(readMemory(row.file_path));
      } catch (e) {
        process.stderr.write(
          `Warning: skipping unreadable memory ${row.file_path}: ${e instanceof Error ? e.message : e}\n`,
        );
      }
    }
    return memories;
  }

  async list(): Promise<Memory[]> {
    syncIndex(this.config, this.db);
    const files = listMemoryFiles(this.config);
    const memories: Memory[] = [];
    for (const filePath of files) {
      try {
        memories.push(readMemory(filePath));
      } catch (e) {
        process.stderr.write(
          `Warning: skipping unreadable memory ${filePath}: ${e instanceof Error ? e.message : e}\n`,
        );
      }
    }
    memories.sort((a, b) => b.updated.localeCompare(a.updated));
    return memories;
  }

  async reindex(): Promise<{ count: number }> {
    const count = await rebuildIndex(this.config, this.db);
    return { count };
  }

  async sync(): Promise<{ message: string }> {
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

    const actions: string[] = [];

    // Pull remote changes first
    const pull = git(['pull', '--rebase', '--autostash']);
    if (pull.status !== 0)
      throw new Error(`git pull failed: ${pull.stderr.trim()}`);
    if (!pull.stdout.includes('Already up to date')) {
      actions.push('pulled');
      syncIndex(this.config, this.db);
    }

    // Commit and push local changes
    if (status.stdout.trim()) {
      const add = git(['add', '-A']);
      if (add.status !== 0)
        throw new Error(`git add failed: ${add.stderr.trim()}`);

      const commit = git(['commit', '-m', 'update memory']);
      if (commit.status !== 0)
        throw new Error(`git commit failed: ${commit.stderr.trim()}`);

      const push = git(['push']);
      if (push.status !== 0)
        throw new Error(`git push failed: ${push.stderr.trim()}`);

      actions.push('pushed');
    }

    return {
      message:
        actions.length > 0 ? actions.join(' and ') : 'Already up to date',
    };
  }

  close(): void {
    this.db.close();
  }
}
