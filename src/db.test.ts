import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import {
  openDb,
  upsertMemoryChecked,
  deleteMemoryFromDb,
  searchFts,
  getMemoryById,
  getMemoryByPrefix,
  getMemoryByFilename,
  recordAccess,
  getAccessCount,
  getAllMemoryIds,
  grepMemories,
  getEmbeddingModel,
  getEmbeddingCount,
  clearDb,
  type DB,
} from './db.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let db: DB;

const mem = (
  overrides?: Partial<Parameters<typeof upsertMemoryChecked>[1]>,
) => ({
  id: crypto.randomUUID(),
  title: 'Test Memory',
  tags: ['test'],
  type: 'knowledge',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  content: 'test content',
  filePath: path.join(testDir, 'memories', 'test.md'),
  contentHash: 'abc123',
  ...overrides,
});

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-db-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();
  db = openDb(config);
});

afterEach(() => {
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
});

describe('openDb', () => {
  it('creates tables', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('memories');
    expect(names).toContain('embeddings');
  });

  it('creates FTS virtual table', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  it('enables case-sensitive LIKE', () => {
    const m = mem({ content: 'CaseSensitive' });
    upsertMemoryChecked(db, m);
    expect(grepMemories(db, 'casesensitive')).toHaveLength(0);
    expect(grepMemories(db, 'CaseSensitive')).toHaveLength(1);
  });

  it('registers regexp function', () => {
    const row = db
      .prepare("SELECT 'hello world' REGEXP 'hello' AS result")
      .get() as { result: number };
    expect(row.result).toBe(1);
  });
});

describe('upsertMemoryChecked', () => {
  it('inserts a new memory', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    const row = getMemoryById(db, m.id);
    expect(row).toBeDefined();
  });

  it('updates existing memory on conflict', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    upsertMemoryChecked(db, { ...m, content: 'updated' });
    const ids = getAllMemoryIds(db);
    expect(ids.size).toBe(1);
  });

  it('updates FTS index on upsert', () => {
    const m = mem({ title: 'Unique Snowflake', content: 'rare content' });
    upsertMemoryChecked(db, m);
    const results = searchFts(db, 'snowflake');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(m.id);
  });

  it('updates FTS on re-upsert without duplicates', () => {
    const m = mem({ title: 'FTS Dedup', content: 'original' });
    upsertMemoryChecked(db, m);
    upsertMemoryChecked(db, { ...m, content: 'changed' });
    const results = searchFts(db, 'dedup');
    expect(results).toHaveLength(1);
  });
});

describe('deleteMemoryFromDb', () => {
  it('removes memory', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    deleteMemoryFromDb(db, m.id);
    expect(getMemoryById(db, m.id)).toBeUndefined();
  });

  it('removes from FTS', () => {
    const m = mem({ title: 'Delete FTS Test', content: 'deleteme' });
    upsertMemoryChecked(db, m);
    deleteMemoryFromDb(db, m.id);
    const results = searchFts(db, 'deleteme');
    expect(results).toHaveLength(0);
  });

  it('no-op for non-existent id', () => {
    expect(() =>
      deleteMemoryFromDb(db, '00000000-0000-0000-0000-000000000000'),
    ).not.toThrow();
  });
});

describe('searchFts', () => {
  it('finds by title', () => {
    const m = mem({ title: 'JavaScript Guide' });
    upsertMemoryChecked(db, m);
    const results = searchFts(db, 'javascript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(m.id);
  });

  it('finds by content', () => {
    const m = mem({ content: 'async await patterns' });
    upsertMemoryChecked(db, m);
    const results = searchFts(db, 'async');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds by tags', () => {
    const m = mem({ tags: ['typescript', 'react'] });
    upsertMemoryChecked(db, m);
    const results = searchFts(db, 'typescript');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns normalized scores', () => {
    const m = mem({ title: 'Score Test' });
    upsertMemoryChecked(db, m);
    const results = searchFts(db, 'score');
    expect(results[0].score).toBe(1);
  });

  it('ranks title higher than content (BM25 weights)', () => {
    const a = mem({
      id: crypto.randomUUID(),
      title: 'Unrelated',
      content: 'typescript patterns',
      filePath: path.join(testDir, 'a.md'),
    });
    const b = mem({
      id: crypto.randomUUID(),
      title: 'TypeScript Guide',
      content: 'some guide',
      filePath: path.join(testDir, 'b.md'),
    });
    upsertMemoryChecked(db, a);
    upsertMemoryChecked(db, b);
    const results = searchFts(db, 'typescript');
    expect(results[0].id).toBe(b.id);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      upsertMemoryChecked(
        db,
        mem({
          id: crypto.randomUUID(),
          title: `Limit Test ${i}`,
          content: 'shared keyword',
          filePath: path.join(testDir, `limit-${i}.md`),
        }),
      );
    }
    const results = searchFts(db, 'shared', 3);
    expect(results).toHaveLength(3);
  });

  it('returns empty for no match', () => {
    const results = searchFts(db, 'nonexistent-xyzzy');
    expect(results).toHaveLength(0);
  });

  it('handles OR-ranked multi-word queries', () => {
    const m = mem({ title: 'retry backoff', content: 'http retry logic' });
    upsertMemoryChecked(db, m);
    const results = searchFts(db, 'retry backoff');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('getMemoryById', () => {
  it('finds by exact id', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    expect(getMemoryById(db, m.id)).toBeDefined();
  });

  it('returns undefined for non-existent', () => {
    expect(
      getMemoryById(db, '00000000-0000-0000-0000-000000000000'),
    ).toBeUndefined();
  });
});

describe('getMemoryByPrefix', () => {
  it('finds by unique prefix', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    const result = getMemoryByPrefix(db, m.id.slice(0, 8));
    expect(result?.id).toBe(m.id);
  });

  it('returns undefined for ambiguous prefix', () => {
    // Two memories with same first 4 chars is unlikely but test the logic
    const m1 = mem({
      id: 'aaaa0000-0000-0000-0000-000000000001',
      filePath: path.join(testDir, 'a.md'),
    });
    const m2 = mem({
      id: 'aaaa0000-0000-0000-0000-000000000002',
      filePath: path.join(testDir, 'b.md'),
    });
    upsertMemoryChecked(db, m1);
    upsertMemoryChecked(db, m2);
    expect(getMemoryByPrefix(db, 'aaaa')).toBeUndefined();
  });
});

describe('getMemoryByFilename', () => {
  it('finds by filename suffix', () => {
    const m = mem({ filePath: '/some/path/my-memory-abc1.md' });
    upsertMemoryChecked(db, m);
    const result = getMemoryByFilename(db, 'my-memory-abc1.md');
    expect(result).toBeDefined();
  });

  it('returns undefined for non-existent', () => {
    expect(getMemoryByFilename(db, 'nope.md')).toBeUndefined();
  });
});

describe('access tracking', () => {
  it('starts at zero', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    expect(getAccessCount(db, m.id)).toBe(0);
  });

  it('increments on recordAccess', () => {
    const m = mem();
    upsertMemoryChecked(db, m);
    recordAccess(db, m.id);
    recordAccess(db, m.id);
    recordAccess(db, m.id);
    expect(getAccessCount(db, m.id)).toBe(3);
  });

  it('returns 0 for non-existent id', () => {
    expect(getAccessCount(db, '00000000-0000-0000-0000-000000000000')).toBe(0);
  });
});

describe('grepMemories', () => {
  it('finds literal substring in content', () => {
    const m = mem({ content: 'findme-exact-string' });
    upsertMemoryChecked(db, m);
    const results = grepMemories(db, 'findme-exact');
    expect(results).toHaveLength(1);
  });

  it('finds in title', () => {
    const m = mem({ title: 'findme-title' });
    upsertMemoryChecked(db, m);
    const results = grepMemories(db, 'findme-title');
    expect(results).toHaveLength(1);
  });

  it('case-sensitive by default', () => {
    const m = mem({ content: 'CaseSensitive' });
    upsertMemoryChecked(db, m);
    expect(grepMemories(db, 'casesensitive')).toHaveLength(0);
    expect(grepMemories(db, 'CaseSensitive')).toHaveLength(1);
  });

  it('case-insensitive with flag', () => {
    const m = mem({ content: 'MiXeD' });
    upsertMemoryChecked(db, m);
    expect(grepMemories(db, 'mixed', 20, true)).toHaveLength(1);
  });

  it('regex search', () => {
    const m = mem({ content: 'async function foo()' });
    upsertMemoryChecked(db, m);
    expect(grepMemories(db, 'async\\s+function', 20, false, true)).toHaveLength(
      1,
    );
  });

  it('regex case-insensitive', () => {
    const m = mem({ content: 'ASYNC function bar()' });
    upsertMemoryChecked(db, m);
    expect(grepMemories(db, 'async\\s+function', 20, true, true)).toHaveLength(
      1,
    );
  });

  it('rejects invalid regex', () => {
    expect(() => grepMemories(db, '[invalid', 20, false, true)).toThrow(
      'Invalid regex',
    );
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      upsertMemoryChecked(
        db,
        mem({
          id: crypto.randomUUID(),
          content: 'shared-grep-token',
          filePath: path.join(testDir, `grep-${i}.md`),
        }),
      );
    }
    expect(grepMemories(db, 'shared-grep-token', 3)).toHaveLength(3);
  });
});

describe('embeddings', () => {
  it('starts with zero count', () => {
    expect(getEmbeddingCount(db)).toBe(0);
  });

  it('returns undefined model when empty', () => {
    expect(getEmbeddingModel(db)).toBeUndefined();
  });
});

describe('clearDb', () => {
  it('removes all memories and FTS', () => {
    upsertMemoryChecked(db, mem());
    clearDb(db, config);
    expect(getAllMemoryIds(db).size).toBe(0);
    expect(searchFts(db, 'test')).toHaveLength(0);
  });
});
