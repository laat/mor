import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  clearDb,
  deleteMemoryFromDb,
  getAllMemoryIds,
  getContentHash,
  getMemoryByFilename,
  getMemoryById,
  getMemoryByPrefix,
  grepMemories,
  openDb,
  searchFts,
  upsertMemoryChecked,
  type DB,
} from './db.js';
import {
  createProvider,
  type EmbeddingProvider,
} from './embeddings/provider.js';
import {
  createMemory,
  deleteMemory,
  listMemoryFiles,
  readMemory,
  readMemoryWithRaw,
  safeReadMemory,
  updateMemory,
} from './memory.js';
import type {
  Config,
  Memory,
  MemoryType,
  Operations,
  SearchResult,
} from './operations.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX_RE = /^[0-9a-f]{4,}$/i;

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class LocalOperations implements Operations {
  private config: Config;
  private db: DB;
  private provider: EmbeddingProvider;
  private lastSyncTime = 0;

  constructor(config: Config) {
    this.config = config;
    this.db = openDb(config);
    this.provider = createProvider(config.embedding);
  }

  // ---- Index management ----

  private syncIndex(): void {
    const files = listMemoryFiles(this.config);
    const dbIds = getAllMemoryIds(this.db);
    const seenIds = new Set<string>();

    for (const filePath of files) {
      const result = readMemoryWithRaw(filePath);
      if (!result) continue;
      const { mem, raw } = result;

      seenIds.add(mem.id);
      const existingHash = getContentHash(this.db, mem.id);

      if (existingHash !== hashContent(raw)) {
        this.upsertFromMemory(mem, raw);
      }
    }

    for (const id of dbIds) {
      if (!seenIds.has(id)) {
        deleteMemoryFromDb(this.db, id);
      }
    }
  }

  private syncIndexIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastSyncTime < 200) return;
    this.lastSyncTime = now;
    this.syncIndex();
  }

  private upsertFromMemory(mem: Memory, raw: string): void {
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
  }

  private async computeEmbedding(mem: Memory): Promise<void> {
    if (this.provider.name === 'none') return;

    const text = `${mem.title}\n${mem.tags.join(', ')}\n${mem.content}`;
    const embedding = await this.provider.embed(text);

    const buffer = Buffer.from(new Float32Array(embedding).buffer);
    this.db
      .prepare(
        `INSERT INTO embeddings (id, embedding, model, dimensions)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET embedding=excluded.embedding, model=excluded.model, dimensions=excluded.dimensions`,
      )
      .run(mem.id, buffer, this.provider.model, embedding.length);
  }

  // ---- Query resolution ----

  private resolveQuery(query: string): Memory | undefined {
    this.syncIndexIfNeeded();

    if (UUID_RE.test(query)) {
      const row = getMemoryById(this.db, query);
      if (row) return readMemory(row.file_path);
    }

    if (UUID_PREFIX_RE.test(query) && query.length >= 4) {
      const row = getMemoryByPrefix(this.db, query);
      if (row) return readMemory(row.file_path);
    }

    const byFilename = getMemoryByFilename(this.db, query);
    if (byFilename) return readMemory(byFilename.file_path);

    if (!query.endsWith('.md')) {
      const byFilenameMd = getMemoryByFilename(this.db, query + '.md');
      if (byFilenameMd) return readMemory(byFilenameMd.file_path);
    }

    try {
      const results = searchFts(this.db, query, 1);
      if (results.length > 0) {
        const row = getMemoryById(this.db, results[0].id);
        if (row) return readMemory(row.file_path);
      }
    } catch {
      // FTS query syntax error
    }

    return undefined;
  }

  // ---- Operations interface ----

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    this.syncIndexIfNeeded();

    const ftsResults = searchFts(this.db, query, limit);
    const ftsMap = new Map(ftsResults.map((r) => [r.id, r.score]));

    const embeddingRows = this.db
      .prepare('SELECT COUNT(*) as count FROM embeddings')
      .get() as { count: number };

    if (embeddingRows.count > 0 && this.provider.name !== 'none') {
      const queryEmbedding = await this.provider.embed(query);

      const allEmbeddings = this.db
        .prepare('SELECT id, embedding FROM embeddings')
        .all() as Array<{ id: string; embedding: Buffer }>;

      const MIN_COSINE_SIMILARITY = 0.15;
      const vectorScores: Array<{ id: string; score: number }> = [];
      for (const row of allEmbeddings) {
        const stored = new Float32Array(
          row.embedding.buffer,
          row.embedding.byteOffset,
          row.embedding.byteLength / 4,
        );
        if (queryEmbedding.length !== stored.length) continue;
        const sim = cosineSimilarity(queryEmbedding, Array.from(stored));
        if (sim >= MIN_COSINE_SIMILARITY) {
          vectorScores.push({ id: row.id, score: (sim + 1) / 2 });
        }
      }

      vectorScores.sort((a, b) => b.score - a.score);
      const topVector = vectorScores.slice(0, limit);
      const vectorMap = new Map(topVector.map((r) => [r.id, r.score]));

      const allIds = new Set([...ftsMap.keys(), ...vectorMap.keys()]);
      const merged: Array<{ id: string; score: number }> = [];
      for (const id of allIds) {
        const ftsScore = ftsMap.get(id) ?? 0;
        const vecScore = vectorMap.get(id) ?? 0;
        merged.push({ id, score: ftsScore * 0.6 + vecScore * 0.4 });
      }
      merged.sort((a, b) => b.score - a.score);

      return merged.slice(0, limit).map((r) => {
        const row = this.db
          .prepare('SELECT file_path FROM memories WHERE id = ?')
          .get(r.id) as { file_path: string };
        const mem = readMemory(row.file_path);
        return {
          memory: mem,
          score: r.score,
          matchType: (vectorMap.has(r.id) ? 'vector' : 'fts') as
            | 'vector'
            | 'fts',
        };
      });
    }

    return ftsResults.map((r) => {
      const row = this.db
        .prepare('SELECT file_path FROM memories WHERE id = ?')
        .get(r.id) as { file_path: string };
      const mem = readMemory(row.file_path);
      return { memory: mem, score: r.score, matchType: 'fts' as const };
    });
  }

  async read(query: string): Promise<Memory | undefined> {
    return this.resolveQuery(query);
  }

  async add(opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: MemoryType;
    repository?: string;
  }): Promise<Memory> {
    const { mem, raw } = createMemory(this.config, opts);
    this.upsertFromMemory(mem, raw);
    await this.computeEmbedding(mem);
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
    const existing = this.resolveQuery(query);
    if (!existing) throw new Error(`Memory not found: ${query}`);
    const { mem, raw } = updateMemory(existing.filePath, updates);
    this.upsertFromMemory(mem, raw);
    await this.computeEmbedding(mem);
    return mem;
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    const mem = this.resolveQuery(query);
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
    this.syncIndexIfNeeded();
    const rows = grepMemories(this.db, pattern, limit, ignoreCase);
    return rows
      .map((row) => safeReadMemory(row.file_path))
      .filter((m): m is Memory => m !== undefined);
  }

  async list(): Promise<Memory[]> {
    this.syncIndex();
    const files = listMemoryFiles(this.config);
    const memories = files
      .map((f) => safeReadMemory(f))
      .filter((m): m is Memory => m !== undefined);
    memories.sort((a, b) => b.updated.localeCompare(a.updated));
    return memories;
  }

  async reindex(): Promise<{ count: number }> {
    clearDb(this.db);
    const files = listMemoryFiles(this.config);

    let count = 0;
    for (const filePath of files) {
      const result = readMemoryWithRaw(filePath);
      if (!result) continue;
      const { mem, raw } = result;

      this.upsertFromMemory(mem, raw);
      await this.computeEmbedding(mem);
      count++;
    }
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

    const pull = git(['pull', '--rebase', '--autostash']);
    if (pull.status !== 0)
      throw new Error(`git pull failed: ${pull.stderr.trim()}`);
    if (!pull.stdout.includes('Already up to date')) {
      actions.push('pulled');
      this.syncIndex();
    }

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
