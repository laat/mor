import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import {
  openDb,
  upsertNoteChecked,
  deleteNoteFromDb,
  searchFts,
  getNoteById,
  getNoteByPrefix,
  getNoteByFilename,
  recordAccess,
  getAccessCount,
  getAllNoteIds,
  grepNotes,
  getEmbeddingModel,
  getEmbeddingCount,
  type DB,
} from './db.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let db: DB;

const note = (overrides?: Partial<Parameters<typeof upsertNoteChecked>[1]>) => {
  const id = overrides?.id ?? crypto.randomUUID();
  return {
    id,
    title: 'Test Note',
    tags: ['test'],
    type: 'knowledge',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    content: 'test content',
    filePath: path.join(testDir, 'memories', `${id}.md`),
    contentHash: 'abc123',
    ...overrides,
  };
};

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
    expect(names).toContain('notes');
    expect(names).toContain('embeddings');
  });

  it('creates FTS virtual table', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  it('enables case-sensitive LIKE', () => {
    const m = note({ content: 'CaseSensitive' });
    upsertNoteChecked(db, m);
    expect(grepNotes(db, 'casesensitive')).toHaveLength(0);
    expect(grepNotes(db, 'CaseSensitive')).toHaveLength(1);
  });

  it('registers regexp function', () => {
    const row = db
      .prepare("SELECT 'hello world' REGEXP 'hello' AS result")
      .get() as { result: number };
    expect(row.result).toBe(1);
  });
});

describe('upsertNoteChecked', () => {
  it('inserts a new note', () => {
    const m = note();
    upsertNoteChecked(db, m);
    const row = getNoteById(db, m.id);
    expect(row).toBeDefined();
  });

  it('updates existing note on conflict', () => {
    const m = note();
    upsertNoteChecked(db, m);
    upsertNoteChecked(db, { ...m, content: 'updated' });
    const ids = getAllNoteIds(db);
    expect(ids.size).toBe(1);
  });

  it('updates FTS index on upsert', () => {
    const m = note({ title: 'Unique Snowflake', content: 'rare content' });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'snowflake');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(m.id);
  });

  it('updates FTS on re-upsert without duplicates', () => {
    const m = note({ title: 'FTS Dedup', content: 'original' });
    upsertNoteChecked(db, m);
    upsertNoteChecked(db, { ...m, content: 'changed' });
    const results = searchFts(db, 'dedup');
    expect(results).toHaveLength(1);
  });
});

describe('deleteNoteFromDb', () => {
  it('removes note', () => {
    const m = note();
    upsertNoteChecked(db, m);
    deleteNoteFromDb(db, m.id);
    expect(getNoteById(db, m.id)).toBeUndefined();
  });

  it('removes from FTS', () => {
    const m = note({ title: 'Delete FTS Test', content: 'deleteme' });
    upsertNoteChecked(db, m);
    deleteNoteFromDb(db, m.id);
    const results = searchFts(db, 'deleteme');
    expect(results).toHaveLength(0);
  });

  it('no-op for non-existent id', () => {
    expect(() =>
      deleteNoteFromDb(db, '00000000-0000-0000-0000-000000000000'),
    ).not.toThrow();
  });
});

describe('searchFts', () => {
  it('finds by title', () => {
    const m = note({ title: 'JavaScript Guide' });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'javascript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(m.id);
  });

  it('finds by content', () => {
    const m = note({ content: 'async await patterns' });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'async');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds by tags', () => {
    const m = note({ tags: ['typescript', 'react'] });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'typescript');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns normalized scores', () => {
    const m = note({ title: 'Score Test' });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'score');
    expect(results[0].score).toBe(1);
  });

  it('ranks title higher than content (BM25 weights)', () => {
    const a = note({
      title: 'Unrelated',
      content: 'typescript patterns',
    });
    const b = note({
      title: 'TypeScript Guide',
      content: 'some guide',
    });
    upsertNoteChecked(db, a);
    upsertNoteChecked(db, b);
    const results = searchFts(db, 'typescript');
    expect(results[0].id).toBe(b.id);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      upsertNoteChecked(
        db,
        note({
          title: `Limit Test ${i}`,
          content: 'shared keyword',
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

  it('handles multi-word queries', () => {
    const m = note({ title: 'retry backoff', content: 'http retry logic' });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'retry backoff');
    expect(results.length).toBeGreaterThan(0);
  });

  it('prefers AND matching over OR', () => {
    const both = note({
      title: 'alpha beta combined',
      content: 'has both terms',
    });
    const onlyAlpha = note({
      title: 'alpha only',
      content: 'just one term',
    });
    upsertNoteChecked(db, both);
    upsertNoteChecked(db, onlyAlpha);

    const results = searchFts(db, 'alpha beta');
    // AND matches first — "alpha only" excluded because both terms are required
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(both.id);
  });

  it('finds by description', () => {
    const m = note({
      title: 'Generic Title',
      description: 'quantum entanglement overview',
      content: 'body text',
    });
    upsertNoteChecked(db, m);
    const results = searchFts(db, 'entanglement');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(m.id);
  });

  it('falls back to OR when AND has no results', () => {
    const a = note({
      title: 'only gamma',
      content: 'gamma content',
    });
    const b = note({
      title: 'only delta',
      content: 'delta content',
    });
    upsertNoteChecked(db, a);
    upsertNoteChecked(db, b);

    // No note has both "gamma" and "delta", so AND fails → OR fallback
    const results = searchFts(db, 'gamma delta');
    expect(results.length).toBe(2);
  });

  it('does not throw on FTS5 special characters', () => {
    const m = note({
      title: 'special chars note',
      content: 'some searchable content',
      filePath: path.join(testDir, 'memories', 'special.md'),
    });
    upsertNoteChecked(db, m);

    // These contain FTS5 reserved operators/syntax that could cause parse
    // errors.  searchFts should catch the error and return empty rather than
    // throwing.
    expect(() => searchFts(db, 'NOT')).not.toThrow();
    expect(() => searchFts(db, 'a OR')).not.toThrow();
    expect(() => searchFts(db, '* wildcard')).not.toThrow();
    expect(() => searchFts(db, 'foo -bar')).not.toThrow();
    expect(() => searchFts(db, 'NEAR(a b)')).not.toThrow();
  });
});

describe('getNoteById', () => {
  it('finds by exact id', () => {
    const m = note();
    upsertNoteChecked(db, m);
    expect(getNoteById(db, m.id)).toBeDefined();
  });

  it('returns undefined for non-existent', () => {
    expect(
      getNoteById(db, '00000000-0000-0000-0000-000000000000'),
    ).toBeUndefined();
  });
});

describe('getNoteByPrefix', () => {
  it('finds by unique prefix', () => {
    const m = note();
    upsertNoteChecked(db, m);
    const result = getNoteByPrefix(db, m.id.slice(0, 8));
    expect(result?.id).toBe(m.id);
  });

  it('returns undefined for ambiguous prefix', () => {
    // Two notes with same first 4 chars is unlikely but test the logic
    const m1 = note({
      id: 'aaaa0000-0000-0000-0000-000000000001',
      filePath: path.join(testDir, 'a.md'),
    });
    const m2 = note({
      id: 'aaaa0000-0000-0000-0000-000000000002',
      filePath: path.join(testDir, 'b.md'),
    });
    upsertNoteChecked(db, m1);
    upsertNoteChecked(db, m2);
    expect(getNoteByPrefix(db, 'aaaa')).toBeUndefined();
  });
});

describe('getNoteByFilename', () => {
  it('finds by filename suffix', () => {
    const m = note({ filePath: '/some/path/my-memory-abc1.md' });
    upsertNoteChecked(db, m);
    const result = getNoteByFilename(db, 'my-memory-abc1.md');
    expect(result).toBeDefined();
  });

  it('returns undefined for non-existent', () => {
    expect(getNoteByFilename(db, 'nope.md')).toBeUndefined();
  });
});

describe('access tracking', () => {
  it('starts at zero', () => {
    const m = note();
    upsertNoteChecked(db, m);
    expect(getAccessCount(db, m.id)).toBe(0);
  });

  it('increments on recordAccess', () => {
    const m = note();
    upsertNoteChecked(db, m);
    recordAccess(db, m.id);
    recordAccess(db, m.id);
    recordAccess(db, m.id);
    expect(getAccessCount(db, m.id)).toBe(3);
  });

  it('returns 0 for non-existent id', () => {
    expect(getAccessCount(db, '00000000-0000-0000-0000-000000000000')).toBe(0);
  });
});

describe('grepNotes', () => {
  it('finds literal substring in content', () => {
    const m = note({ content: 'findme-exact-string' });
    upsertNoteChecked(db, m);
    const results = grepNotes(db, 'findme-exact');
    expect(results).toHaveLength(1);
  });

  it('finds in title', () => {
    const m = note({ title: 'findme-title' });
    upsertNoteChecked(db, m);
    const results = grepNotes(db, 'findme-title');
    expect(results).toHaveLength(1);
  });

  it('case-sensitive by default', () => {
    const m = note({ content: 'CaseSensitive' });
    upsertNoteChecked(db, m);
    expect(grepNotes(db, 'casesensitive')).toHaveLength(0);
    expect(grepNotes(db, 'CaseSensitive')).toHaveLength(1);
  });

  it('case-insensitive with flag', () => {
    const m = note({ content: 'MiXeD' });
    upsertNoteChecked(db, m);
    expect(grepNotes(db, 'mixed', 20, true)).toHaveLength(1);
  });

  it('regex search', () => {
    const m = note({ content: 'async function foo()' });
    upsertNoteChecked(db, m);
    expect(grepNotes(db, 'async\\s+function', 20, false, true)).toHaveLength(1);
  });

  it('regex case-insensitive', () => {
    const m = note({ content: 'ASYNC function bar()' });
    upsertNoteChecked(db, m);
    expect(grepNotes(db, 'async\\s+function', 20, true, true)).toHaveLength(1);
  });

  it('handles alternating regex patterns without cache thrashing', () => {
    const m1 = note({
      id: crypto.randomUUID(),
      content: 'async function hello()',
      filePath: path.join(testDir, 'alt-1.md'),
    });
    const m2 = note({
      id: crypto.randomUUID(),
      content: 'class MyWidget extends Base',
      filePath: path.join(testDir, 'alt-2.md'),
    });
    upsertNoteChecked(db, m1);
    upsertNoteChecked(db, m2);

    // Use two different regex patterns in separate grep calls
    const asyncResults = grepNotes(db, 'async\\s+function', 20, false, true);
    const classResults = grepNotes(db, 'class\\s+\\w+', 20, false, true);

    expect(asyncResults).toHaveLength(1);
    expect(asyncResults[0].id).toBe(m1.id);
    expect(classResults).toHaveLength(1);
    expect(classResults[0].id).toBe(m2.id);

    // Run again to confirm cached patterns still work
    const asyncAgain = grepNotes(db, 'async\\s+function', 20, false, true);
    const classAgain = grepNotes(db, 'class\\s+\\w+', 20, false, true);
    expect(asyncAgain).toHaveLength(1);
    expect(classAgain).toHaveLength(1);
  });

  it('rejects invalid regex', () => {
    expect(() => grepNotes(db, '[invalid', 20, false, true)).toThrow(
      'Invalid regex',
    );
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      upsertNoteChecked(
        db,
        note({
          content: 'shared-grep-token',
        }),
      );
    }
    expect(grepNotes(db, 'shared-grep-token', 3)).toHaveLength(3);
  });

  it('supports offset', () => {
    for (let i = 0; i < 5; i++) {
      upsertNoteChecked(
        db,
        note({
          content: 'offset-grep-token',
          filePath: path.join(testDir, `grep-off-${i}.md`),
        }),
      );
    }
    const all5 = grepNotes(db, 'offset-grep-token', 20, false, false, 0);
    expect(all5).toHaveLength(5);
    const skipped = grepNotes(db, 'offset-grep-token', 20, false, false, 3);
    expect(skipped).toHaveLength(2);
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
