import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  clearDb,
  deleteMemoryFromDb,
  getAllMemoryIds,
  getContentHash,
  searchFts,
  upsertMemoryChecked,
  type DB,
} from './db.js';
import {
  createProvider,
  type EmbeddingProvider,
} from './embeddings/provider.js';
import { listMemoryFiles, readMemory } from './memory.js';
import type { Config, Memory, SearchResult } from './types.js';

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const lastSyncMap = new WeakMap<DB, number>();

/** Debounced syncIndex for read paths — skips if synced within 200ms */
export function syncIndexIfNeeded(config: Config, db: DB): void {
  const now = Date.now();
  const last = lastSyncMap.get(db) ?? 0;
  if (now - last < 200) return;
  lastSyncMap.set(db, now);
  syncIndex(config, db);
}

export function syncIndex(config: Config, db: DB): void {
  const files = listMemoryFiles(config);
  const dbIds = getAllMemoryIds(db);
  const seenIds = new Set<string>();

  for (const filePath of files) {
    let mem: Memory;
    try {
      mem = readMemory(filePath);
    } catch (e) {
      process.stderr.write(
        `Warning: skipping unreadable memory ${filePath}: ${e instanceof Error ? e.message : e}\n`,
      );
      continue;
    }

    seenIds.add(mem.id);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const hash = hashContent(raw);
    const existingHash = getContentHash(db, mem.id);

    if (existingHash !== hash) {
      upsertMemoryChecked(db, {
        id: mem.id,
        title: mem.title,
        tags: mem.tags,
        type: mem.type,
        repository: mem.repository,
        created: mem.created,
        updated: mem.updated,
        content: mem.content,
        filePath,
        contentHash: hash,
      });
    }
  }

  // Delete DB entries for files that no longer exist
  for (const id of dbIds) {
    if (!seenIds.has(id)) {
      deleteMemoryFromDb(db, id);
    }
  }
}

export async function reindex(config: Config, db: DB): Promise<number> {
  clearDb(db);
  const files = listMemoryFiles(config);
  const provider = createProvider(config.embedding);

  for (const filePath of files) {
    let mem: Memory;
    try {
      mem = readMemory(filePath);
    } catch (e) {
      process.stderr.write(
        `Warning: skipping unreadable memory ${filePath}: ${e instanceof Error ? e.message : e}\n`,
      );
      continue;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const hash = hashContent(raw);

    upsertMemoryChecked(db, {
      id: mem.id,
      title: mem.title,
      tags: mem.tags,
      type: mem.type,
      repository: mem.repository,
      created: mem.created,
      updated: mem.updated,
      content: mem.content,
      filePath,
      contentHash: hash,
    });

    await computeAndStoreEmbedding(db, provider, mem);
  }
  return files.length;
}

export async function computeAndStoreEmbedding(
  db: DB,
  provider: EmbeddingProvider,
  mem: Memory,
): Promise<void> {
  if (provider.name === 'none') return;

  const text = `${mem.title}\n${mem.tags.join(', ')}\n${mem.content}`;
  const embedding = await provider.embed(text);

  const buffer = Buffer.from(new Float32Array(embedding).buffer);
  db.prepare(
    `INSERT INTO embeddings (id, embedding, model, dimensions)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET embedding=excluded.embedding, model=excluded.model, dimensions=excluded.dimensions`,
  ).run(mem.id, buffer, provider.model, embedding.length);
}

export async function searchAsync(
  config: Config,
  db: DB,
  query: string,
  limit = 20,
  provider?: EmbeddingProvider,
): Promise<SearchResult[]> {
  syncIndexIfNeeded(config, db);

  const ftsResults = searchFts(db, query, limit);
  const ftsMap = new Map(ftsResults.map((r) => [r.id, r.score]));

  // Check for embeddings
  const embeddingRows = db
    .prepare('SELECT COUNT(*) as count FROM embeddings')
    .get() as { count: number };
  const effectiveProvider = provider ?? createProvider(config.embedding);

  if (embeddingRows.count > 0 && effectiveProvider.name !== 'none') {
    const queryEmbedding = await effectiveProvider.embed(query);

    const allEmbeddings = db
      .prepare('SELECT id, embedding FROM embeddings')
      .all() as Array<{
      id: string;
      embedding: Buffer;
    }>;

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

    // Merge: FTS weight 0.6, vector weight 0.4
    const allIds = new Set([...ftsMap.keys(), ...vectorMap.keys()]);
    const merged: Array<{ id: string; score: number }> = [];
    for (const id of allIds) {
      const ftsScore = ftsMap.get(id) ?? 0;
      const vecScore = vectorMap.get(id) ?? 0;
      merged.push({ id, score: ftsScore * 0.6 + vecScore * 0.4 });
    }
    merged.sort((a, b) => b.score - a.score);

    return merged.slice(0, limit).map((r) => {
      const row = db
        .prepare('SELECT file_path FROM memories WHERE id = ?')
        .get(r.id) as { file_path: string };
      const mem = readMemory(row.file_path);
      return {
        memory: mem,
        score: r.score,
        matchType: (vectorMap.has(r.id) ? 'vector' : 'fts') as 'vector' | 'fts',
      };
    });
  }

  return ftsResults.map((r) => {
    const row = db
      .prepare('SELECT file_path FROM memories WHERE id = ?')
      .get(r.id) as { file_path: string };
    const mem = readMemory(row.file_path);
    return { memory: mem, score: r.score, matchType: 'fts' as const };
  });
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
