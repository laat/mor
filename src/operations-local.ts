import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  clearDb,
  deleteMemoryFromDb,
  getAllMemoryIds,
  getContentHash,
  getEmbeddingCount,
  getMemoryByFilename,
  getMemoryById,
  getMemoryByPrefix,
  grepMemories,
  openDb,
  searchFts,
  searchVec,
  upsertEmbedding,
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
  GrepOptions,
  Memory,
  MemoryFilter,
  MemoryType,
  Operations,
  Paginated,
  SearchResult,
} from './operations.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX_RE = /^[0-9a-f]{4,}$/i;

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

import { matchGlob } from './utils/glob.js';

function matchMemory(mem: Memory, filter: MemoryFilter): boolean {
  if (filter.type) {
    const types = filter.type.split(',').map((t) => t.trim());
    if (!types.some((t) => matchGlob(mem.type, t))) return false;
  }
  if (filter.tag) {
    if (!mem.tags.some((tag) => matchGlob(tag, filter.tag!))) return false;
  }
  if (filter.repo) {
    if (!mem.repository || !matchGlob(mem.repository, filter.repo))
      return false;
  }
  if (filter.ext) {
    const ext = filter.ext.startsWith('.') ? filter.ext : `.${filter.ext}`;
    if (!mem.title.toLowerCase().endsWith(ext.toLowerCase())) return false;
  }
  return true;
}

function applyMemoryFilter(
  memories: Memory[],
  filter?: MemoryFilter,
): Memory[] {
  if (!filter || (!filter.type && !filter.tag && !filter.repo && !filter.ext))
    return memories;
  return memories.filter((mem) => matchMemory(mem, filter));
}

function applyResultFilter(
  results: SearchResult[],
  filter?: MemoryFilter,
): SearchResult[] {
  if (!filter || (!filter.type && !filter.tag && !filter.repo && !filter.ext))
    return results;
  return results.filter((r) => matchMemory(r.memory, filter));
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
    const changed: Memory[] = [];

    for (const filePath of files) {
      const result = readMemoryWithRaw(filePath);
      if (!result) continue;
      const { mem, raw } = result;

      seenIds.add(mem.id);
      const existingHash = getContentHash(this.db, mem.id);

      if (existingHash !== hashContent(raw)) {
        this.upsertFromMemory(mem, raw);
        changed.push(mem);
      }
    }

    for (const id of dbIds) {
      if (!seenIds.has(id)) {
        deleteMemoryFromDb(this.db, id);
      }
    }

    if (changed.length > 0) {
      this.computeEmbeddingsInBackground(changed);
    }
  }

  private syncIndexIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastSyncTime < 200) return;
    this.lastSyncTime = now;
    this.syncIndex();
  }

  private computeEmbeddingsInBackground(memories: Memory[]): void {
    if (this.provider.name === 'none') return;
    (async () => {
      for (const mem of memories) {
        await this.computeEmbedding(mem);
      }
    })().catch((e) => {
      process.stderr.write(
        `Warning: background embedding failed: ${e instanceof Error ? e.message : e}\n`,
      );
    });
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

    try {
      const text = `${mem.title}\n${mem.tags.join(', ')}\n${mem.content}`;
      const embedding = await this.provider.embed(text);

      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      upsertEmbedding(
        this.db,
        mem.id,
        buffer,
        this.provider.model,
        embedding.length,
      );
    } catch (e) {
      process.stderr.write(
        `Warning: embedding failed for ${mem.id}: ${e instanceof Error ? e.message : e}\n`,
      );
    }
  }

  // ---- Query resolution ----

  private resolveById(id: string): Memory | undefined {
    this.syncIndexIfNeeded();

    if (UUID_RE.test(id)) {
      const row = getMemoryById(this.db, id);
      if (row) return readMemory(row.file_path);
    }

    if (UUID_PREFIX_RE.test(id) && id.length >= 8) {
      const row = getMemoryByPrefix(this.db, id);
      if (row) return readMemory(row.file_path);
    }

    return undefined;
  }

  private resolveQuery(query: string): Memory | undefined {
    const byId = this.resolveById(query);
    if (byId) return byId;

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

  async search(
    query: string,
    limit = 20,
    filter?: MemoryFilter,
    offset = 0,
  ): Promise<Paginated<SearchResult>> {
    this.syncIndexIfNeeded();

    // Fetch enough to cover offset + limit after filtering
    const fetchLimit = offset + limit + 50;
    const ftsResults = searchFts(this.db, query, fetchLimit);
    const ftsMap = new Map(ftsResults.map((r) => [r.id, r.score]));

    let all: SearchResult[];

    if (this.provider.name !== 'none' && getEmbeddingCount(this.db) > 0) {
      const queryEmbedding = await this.provider.embed(query);

      // KNN search via sqlite-vec (cosine distance: 0 = identical, 2 = opposite)
      const MAX_COSINE_DISTANCE = 1.7;
      const vecResults = searchVec(this.db, queryEmbedding, fetchLimit);
      const vectorMap = new Map(
        vecResults
          .filter((r) => r.distance <= MAX_COSINE_DISTANCE)
          .map((r) => [r.id, 1 - r.distance / 2]),
      );

      const allIds = new Set([...ftsMap.keys(), ...vectorMap.keys()]);
      const merged: Array<{ id: string; score: number }> = [];
      for (const id of allIds) {
        const ftsScore = ftsMap.get(id) ?? 0;
        const vecScore = vectorMap.get(id) ?? 0;
        merged.push({ id, score: ftsScore * 0.6 + vecScore * 0.4 });
      }
      merged.sort((a, b) => b.score - a.score);

      const results: SearchResult[] = [];
      for (const r of merged) {
        const row = getMemoryById(this.db, r.id);
        if (!row) continue;
        results.push({
          memory: readMemory(row.file_path),
          score: r.score,
          matchType: vectorMap.has(r.id) ? 'vector' : 'fts',
        });
      }
      all = applyResultFilter(results, filter);
    } else {
      const results: SearchResult[] = [];
      for (const r of ftsResults) {
        const row = getMemoryById(this.db, r.id);
        if (!row) continue;
        results.push({
          memory: readMemory(row.file_path),
          score: r.score,
          matchType: 'fts',
        });
      }
      all = applyResultFilter(results, filter);
    }

    return {
      data: all.slice(offset, offset + limit),
      total: all.length,
      offset,
      limit,
    };
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
    await this.autoSync(`add: ${mem.title}`);
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
    const existing = this.resolveById(query);
    if (!existing)
      throw new Error(
        `Memory not found for ID: ${query}. Use a full UUID or 8+ char prefix.`,
      );
    const { mem, raw } = updateMemory(existing.filePath, updates);
    this.upsertFromMemory(mem, raw);
    await this.computeEmbedding(mem);
    await this.autoSync(`update: ${mem.title}`);
    return mem;
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    const mem = this.resolveById(query);
    if (!mem)
      throw new Error(
        `Memory not found for ID: ${query}. Use a full UUID or 8+ char prefix.`,
      );
    deleteMemory(mem.filePath);
    deleteMemoryFromDb(this.db, mem.id);
    await this.autoSync(`remove: ${mem.title}`);
    return { title: mem.title, id: mem.id };
  }

  async grep(pattern: string, opts?: GrepOptions): Promise<Paginated<Memory>> {
    const {
      limit = 20,
      ignoreCase = false,
      filter,
      offset = 0,
      regex = false,
    } = opts ?? {};
    this.syncIndexIfNeeded();
    const rows = grepMemories(
      this.db,
      pattern,
      offset + limit + 50,
      ignoreCase,
      regex,
    );
    const all = applyMemoryFilter(
      rows
        .map((row) => safeReadMemory(row.file_path))
        .filter((m): m is Memory => m !== undefined),
      filter,
    );
    return {
      data: all.slice(offset, offset + limit),
      total: all.length,
      offset,
      limit,
    };
  }

  async list(
    filter?: MemoryFilter,
    limit = 100,
    offset = 0,
  ): Promise<Paginated<Memory>> {
    this.syncIndex();
    const files = listMemoryFiles(this.config);
    const all = applyMemoryFilter(
      files
        .map((f) => safeReadMemory(f))
        .filter((m): m is Memory => m !== undefined),
      filter,
    );
    all.sort((a, b) => b.updated.localeCompare(a.updated));
    return {
      data: all.slice(offset, offset + limit),
      total: all.length,
      offset,
      limit,
    };
  }

  async reindex() {
    clearDb(this.db, this.config);
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
    const emb = this.config.embedding;
    return {
      count,
      embedding:
        emb && emb.provider !== 'none'
          ? {
              provider: emb.provider,
              model: emb.model,
              dimensions: emb.dimensions,
              baseUrl: emb.baseUrl,
            }
          : undefined,
    };
  }

  async sync(commitMessage?: string): Promise<{ message: string }> {
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

      const commit = git(['commit', '-m', commitMessage ?? 'update memory']);
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

  private async autoSync(commitMessage: string): Promise<void> {
    if (!this.config.autosync) return;
    try {
      await this.sync(commitMessage);
    } catch (e) {
      process.stderr.write(
        `Warning: autosync failed: ${e instanceof Error ? e.message : e}\n`,
      );
    }
  }

  close(): void {
    this.db.close();
  }
}
