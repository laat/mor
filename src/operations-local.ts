import crypto from 'node:crypto';
import PQueue from 'p-queue';
import { spawnSync } from 'node:child_process';
import {
  clearDb,
  deleteNoteFromDb,
  getAllContentHashes,
  getAllNoteIds,
  getBacklinks,
  getEmbeddingCount,
  getEmbeddingModel,
  getForwardLinks,
  getNotesByIds,
  recordAccess,
  getNoteByFilename,
  getNoteById,
  getNoteByPrefix,
  grepNotes,
  openDb,
  searchFts,
  searchVec,
  upsertEmbedding,
  upsertLinks,
  upsertNoteChecked,
  type DB,
} from './db.js';
import {
  createProvider,
  type EmbeddingProvider,
} from './embeddings/provider.js';
import {
  createNote,
  deleteNote,
  listNoteFiles,
  readNote,
  tryReadNote,
  updateNote,
} from './note.js';
import { extractLinkIds, parseFrontmatterLinks } from './utils/links.js';
import matter from 'gray-matter';
import type {
  Config,
  GrepOptions,
  Note,
  NoteFilter,
  NoteType,
  Operations,
  Paginated,
  ScoringMode,
  SearchPage,
  SearchResult,
} from './operations.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX_RE = /^[0-9a-f]{8,}$/i;
const FILTER_BUFFER = 50;
const ACCESS_BOOST_CAP = 50;
const ACCESS_BOOST_WEIGHT = 0.001;

import { matchGlob } from './utils/glob.js';

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function matchNote(note: Note, filter: NoteFilter): boolean {
  if (filter.type) {
    const types = filter.type.split(',').map((t) => t.trim());
    if (!types.some((t) => matchGlob(note.type, t))) return false;
  }
  if (filter.tag?.length) {
    if (!filter.tag.every((t) => note.tags.some((tag) => matchGlob(tag, t))))
      return false;
  }
  if (filter.repo) {
    if (!note.repository || !matchGlob(note.repository, filter.repo))
      return false;
  }
  if (filter.ext) {
    const ext = filter.ext.startsWith('.') ? filter.ext : `.${filter.ext}`;
    if (!note.title.toLowerCase().endsWith(ext.toLowerCase())) return false;
  }
  return true;
}

function applyFilter<T>(
  items: T[],
  getNote: (item: T) => Note,
  filter?: NoteFilter,
): T[] {
  if (
    !filter ||
    (!filter.type && !filter.tag?.length && !filter.repo && !filter.ext)
  )
    return items;
  return items.filter((item) => matchNote(getNote(item), filter));
}

export class LocalOperations implements Operations {
  private config: Config;
  private db: DB;
  private provider: EmbeddingProvider;
  private lastSyncTime = 0;
  private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncMessages: string[] = [];
  private embeddingQueue = new PQueue({ concurrency: 1 });

  constructor(config: Config) {
    this.config = config;
    this.db = openDb(config);
    this.provider = createProvider(config.embedding);
    this.checkEmbeddingModel();
  }

  private checkEmbeddingModel(): void {
    if (this.provider.name === 'none') return;
    const storedModel = getEmbeddingModel(this.db);
    if (storedModel && storedModel !== this.provider.model) {
      process.stderr.write(
        `Warning: embeddings were generated with "${storedModel}" but current model is "${this.provider.model}". Run "mor reindex" to rebuild.\n`,
      );
    }
  }

  private syncIndex(): void {
    const files = listNoteFiles(this.config);
    const dbIds = getAllNoteIds(this.db);
    const hashes = getAllContentHashes(this.db);
    const seenIds = new Set<string>();
    const changed: Note[] = [];

    for (const filePath of files) {
      const result = tryReadNote(filePath);
      if (!result) continue;
      const { note, raw } = result;

      seenIds.add(note.id);
      if (hashes.get(note.id) !== hashContent(raw)) {
        this.upsertFromNote(note, raw);
        changed.push(note);
      }
    }

    for (const id of dbIds) {
      if (!seenIds.has(id)) {
        deleteNoteFromDb(this.db, id);
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

  private computeEmbeddingsInBackground(notes: Note[]): void {
    if (this.provider.name === 'none') return;
    for (const note of notes) {
      this.embeddingQueue.add(() => this.computeEmbedding(note));
    }
  }

  private upsertFromNote(note: Note, raw: string): void {
    upsertNoteChecked(this.db, {
      id: note.id,
      title: note.title,
      tags: note.tags,
      type: note.type,
      repository: note.repository,
      created: note.created,
      updated: note.updated,
      content: note.content,
      filePath: note.filePath,
      contentHash: hashContent(raw),
    });
    this.updateLinks(note.id, note.content, raw);
  }

  private updateLinks(noteId: string, content: string, raw: string): void {
    const { data } = matter(raw);
    const fmLinks = parseFrontmatterLinks(data as Record<string, unknown>);
    const rawIds = extractLinkIds(content, fmLinks);

    // Resolve short IDs to full UUIDs where possible
    const resolved: string[] = [];
    for (const id of rawIds) {
      if (id === noteId) continue; // skip self-references
      if (UUID_RE.test(id)) {
        resolved.push(id);
      } else if (UUID_PREFIX_RE.test(id)) {
        const row = getNoteByPrefix(this.db, id);
        resolved.push(row ? row.id : id);
      } else {
        resolved.push(id);
      }
    }

    upsertLinks(this.db, noteId, resolved);
  }

  private async computeEmbedding(note: Note): Promise<void> {
    if (this.provider.name === 'none') return;

    try {
      const text = `${note.title}\n${note.tags.join(', ')}\n${note.content}`;
      const embedding = await this.provider.embed(text);

      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      upsertEmbedding(
        this.db,
        note.id,
        buffer,
        this.provider.model,
        embedding.length,
      );
    } catch (e) {
      process.stderr.write(
        `Warning: embedding failed for ${note.id}: ${e instanceof Error ? e.message : e}\n`,
      );
    }
  }

  private resolveById(id: string): Note | undefined {
    this.syncIndexIfNeeded();

    if (UUID_RE.test(id)) {
      const row = getNoteById(this.db, id);
      if (row) return readNote(row.file_path);
    }

    if (UUID_PREFIX_RE.test(id)) {
      const row = getNoteByPrefix(this.db, id);
      if (row) return readNote(row.file_path);
    }

    return undefined;
  }

  private async resolveQuery(query: string): Promise<Note | undefined> {
    const byId = this.resolveById(query);
    if (byId) return byId;

    const byFilename = getNoteByFilename(this.db, query);
    if (byFilename) return readNote(byFilename.file_path);

    if (!query.endsWith('.md')) {
      const byFilenameMd = getNoteByFilename(this.db, query + '.md');
      if (byFilenameMd) return readNote(byFilenameMd.file_path);
    }

    try {
      const page = await this.search(query, 1);
      if (page.data.length > 0) return page.data[0].note;
    } catch {
      // search error
    }

    return undefined;
  }

  async search(
    query: string,
    limit = 20,
    filter?: NoteFilter,
    offset = 0,
  ): Promise<SearchPage> {
    this.syncIndexIfNeeded();

    // Resolve by ID or ID prefix before falling back to FTS
    const byId = this.resolveById(query);
    if (byId) {
      const matches = applyFilter(
        [{ note: byId, score: 1, matchType: 'uuid' as const }],
        (r) => r.note,
        filter,
      );
      if (matches.length > 0 && offset === 0) {
        return { data: matches, total: 1, offset: 0, limit, scoring: 'fts' };
      }
      return { data: [], total: 0, offset, limit, scoring: 'fts' };
    }

    // Fetch enough to cover offset + limit after filtering
    const fetchLimit = offset + limit + FILTER_BUFFER;
    const ftsResults = searchFts(this.db, query, fetchLimit);

    let filtered: SearchResult[];
    let scoring: ScoringMode;

    if (this.provider.name !== 'none' && getEmbeddingCount(this.db) > 0) {
      scoring = 'hybrid';
      const queryEmbedding = await this.provider.embed(query);

      // KNN search via sqlite-vec (cosine distance: 0 = identical, 2 = opposite)
      const MAX_COSINE_DISTANCE = 1.7;
      const vecResults = searchVec(this.db, queryEmbedding, fetchLimit);
      const vectorMap = new Map(
        vecResults
          .filter((r) => r.distance <= MAX_COSINE_DISTANCE)
          .map((r) => [r.id, 1 - r.distance / 2]),
      );

      // Hybrid fusion: weighted normalized FTS rank + raw cosine similarity
      // FTS component: (k+1)/(k+rank) — 1.0 at rank 1, decays with rank
      // Vector component: cosine similarity (0–1)
      // Weighted 60/40 toward FTS so text matches dominate
      const RRF_K = 60;
      const FTS_WEIGHT = 0.6;
      const VEC_WEIGHT = 0.4;
      const ftsRanks = new Map(ftsResults.map((r, i) => [r.id, i + 1]));

      const allIds = [...new Set([...ftsRanks.keys(), ...vectorMap.keys()])];
      const noteRows = getNotesByIds(this.db, allIds);
      const merged: Array<{ id: string; score: number }> = [];
      for (const id of allIds) {
        const ftsScore = ftsRanks.has(id)
          ? (RRF_K + 1) / (RRF_K + ftsRanks.get(id)!)
          : 0;
        const vecScore = vectorMap.get(id) ?? 0;
        let score = FTS_WEIGHT * ftsScore + VEC_WEIGHT * vecScore;
        const accesses = noteRows.get(id)?.access_count ?? 0;
        score *= 1 + Math.min(accesses, ACCESS_BOOST_CAP) * ACCESS_BOOST_WEIGHT;
        merged.push({ id, score });
      }
      merged.sort((a, b) => b.score - a.score);

      const results: SearchResult[] = [];
      for (const r of merged) {
        const row = noteRows.get(r.id);
        if (!row) continue;
        results.push({
          note: readNote(row.file_path),
          score: r.score,
          matchType: vectorMap.has(r.id) ? 'vector' : 'fts',
        });
      }
      filtered = applyFilter(results, (r) => r.note, filter);
    } else {
      scoring = 'fts';
      const ids = ftsResults.map((r) => r.id);
      const noteRows = getNotesByIds(this.db, ids);
      const results: SearchResult[] = [];
      for (const r of ftsResults) {
        const row = noteRows.get(r.id);
        if (!row) continue;
        results.push({
          note: readNote(row.file_path),
          score:
            r.score *
            (1 +
              Math.min(row.access_count, ACCESS_BOOST_CAP) *
                ACCESS_BOOST_WEIGHT),
          matchType: 'fts',
        });
      }
      results.sort((a, b) => b.score - a.score);
      filtered = applyFilter(results, (r) => r.note, filter);
    }

    return {
      data: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
      scoring,
    };
  }

  async read(query: string): Promise<Note | undefined> {
    const note = await this.resolveQuery(query);
    if (note) recordAccess(this.db, note.id);
    return note;
  }

  async getLinks(noteId: string): Promise<{
    forward: Array<{ id: string; title: string }>;
    back: Array<{ id: string; title: string }>;
  }> {
    return {
      forward: getForwardLinks(this.db, noteId),
      back: getBacklinks(this.db, noteId),
    };
  }

  async add(opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: NoteType;
    repository?: string;
  }): Promise<Note> {
    const { note, raw } = createNote(this.config, opts);
    this.upsertFromNote(note, raw);
    await this.computeEmbedding(note);
    this.autoSync(`add: ${note.title}`);
    return note;
  }

  async update(
    query: string,
    updates: {
      title?: string;
      description?: string;
      content?: string;
      tags?: string[];
      type?: NoteType;
    },
  ): Promise<Note> {
    const existing = this.resolveById(query);
    if (!existing)
      throw new NotFoundError(
        `Note not found for ID: ${query}. Use a full UUID or 8+ char prefix.`,
      );
    const { note, raw } = updateNote(existing.filePath, updates);
    this.upsertFromNote(note, raw);
    await this.computeEmbedding(note);
    this.autoSync(`update: ${note.title}`);
    return note;
  }

  async patch(query: string, oldStr: string, newStr: string): Promise<Note> {
    const existing = await this.resolveQuery(query);
    if (!existing) throw new NotFoundError(`Note not found: ${query}`);
    const count = existing.content.split(oldStr).length - 1;
    if (count === 0)
      throw new Error(
        `old_str not found in note content. Make sure it appears exactly once.`,
      );
    if (count > 1)
      throw new Error(
        `old_str appears ${count} times in note content. It must appear exactly once.`,
      );
    const newContent = existing.content.replace(oldStr, newStr);
    return this.update(existing.id, { content: newContent });
  }

  async remove(query: string): Promise<{ title: string; id: string }> {
    const note = this.resolveById(query);
    if (!note)
      throw new NotFoundError(
        `Note not found for ID: ${query}. Use a full UUID or 8+ char prefix.`,
      );
    deleteNote(note.filePath);
    deleteNoteFromDb(this.db, note.id);
    this.autoSync(`remove: ${note.title}`);
    return { title: note.title, id: note.id };
  }

  async grep(pattern: string, opts?: GrepOptions): Promise<Paginated<Note>> {
    const {
      limit = 20,
      ignoreCase = false,
      filter,
      offset = 0,
      regex = false,
    } = opts ?? {};
    this.syncIndexIfNeeded();
    const rows = grepNotes(
      this.db,
      pattern,
      offset + limit + FILTER_BUFFER,
      ignoreCase,
      regex,
    );
    const filtered = applyFilter(
      rows
        .map((row) => tryReadNote(row.file_path)?.note)
        .filter((m): m is Note => m !== undefined),
      (m) => m,
      filter,
    );
    return {
      data: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
  }

  async list(
    filter?: NoteFilter,
    limit = 100,
    offset = 0,
  ): Promise<Paginated<Note>> {
    this.syncIndexIfNeeded();
    const files = listNoteFiles(this.config);
    const filtered = applyFilter(
      files
        .map((f) => tryReadNote(f)?.note)
        .filter((m): m is Note => m !== undefined),
      (m) => m,
      filter,
    );
    filtered.sort((a, b) => b.updated.localeCompare(a.updated));
    return {
      data: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
  }

  async reindex() {
    clearDb(this.db, this.config);
    const files = listNoteFiles(this.config);

    let count = 0;
    for (const filePath of files) {
      const result = tryReadNote(filePath);
      if (!result) continue;
      const { note, raw } = result;

      this.upsertFromNote(note, raw);
      await this.computeEmbedding(note);
      count++;
    }
    // Second pass: re-resolve links now that all notes are indexed
    // (first pass may store short IDs for notes not yet indexed)
    for (const filePath of files) {
      const result = tryReadNote(filePath);
      if (!result) continue;
      const { note, raw } = result;
      this.updateLinks(note.id, note.content, raw);
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
    const dir = this.config.notesDir;
    const git = (args: string[]) =>
      spawnSync('git', args, {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

    const preStatus = git(['status', '--porcelain']);
    if (preStatus.status !== 0) {
      throw new Error('Notes folder is not a git repository');
    }

    const actions: string[] = [];

    const pull = git(['pull', '--rebase', '--autostash']);
    if (pull.status !== 0)
      throw new Error(`git pull failed: ${pull.stderr.trim()}`);
    if (!pull.stdout.includes('Already up to date')) {
      actions.push('pulled');
      this.syncIndex();
    }

    const postStatus = git(['status', '--porcelain']);
    if (postStatus.stdout.trim()) {
      const add = git(['add', '-A']);
      if (add.status !== 0)
        throw new Error(`git add failed: ${add.stderr.trim()}`);

      const commit = git(['commit', '-m', commitMessage ?? 'update notes']);
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

  private autoSync(commitMessage: string): void {
    if (!this.config.autosync) return;
    this.autoSyncMessages.push(commitMessage);
    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
    this.autoSyncTimer = setTimeout(() => this.flushAutoSync(), 2000);
  }

  private flushAutoSync(): void {
    if (this.autoSyncMessages.length === 0) return;
    const messages = this.autoSyncMessages.splice(0);
    this.autoSyncTimer = null;
    const commitMessage =
      messages.length === 1 ? messages[0] : messages.join(', ');
    this.sync(commitMessage).catch((e) => {
      process.stderr.write(
        `Warning: autosync failed: ${e instanceof Error ? e.message : e}\n`,
      );
    });
  }

  async close(): Promise<void> {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.autoSyncMessages.length > 0) {
      const messages = this.autoSyncMessages.splice(0);
      const commitMessage =
        messages.length === 1 ? messages[0] : messages.join(', ');
      try {
        // sync() uses spawnSync internally, so this completes before db.close()
        await this.sync(commitMessage);
      } catch (e) {
        process.stderr.write(
          `Warning: autosync on close failed: ${e instanceof Error ? e.message : e}\n`,
        );
      }
    }
    this.embeddingQueue.clear();
    await this.embeddingQueue.onIdle();
    this.db.close();
  }
}
