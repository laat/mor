import Database from 'better-sqlite3';
import { SQL, type SQLStatement } from 'sql-template-strings';
import type { Config } from './operations.js';

export type DB = Database.Database;

// Bridge: sql-template-strings → better-sqlite3
function get<T>(db: DB, query: SQLStatement): T | undefined {
  return db.prepare(query.sql).get(...query.values) as T | undefined;
}
function all<T>(db: DB, query: SQLStatement): T[] {
  return db.prepare(query.sql).all(...query.values) as T[];
}
function run(db: DB, query: SQLStatement) {
  return db.prepare(query.sql).run(...query.values);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'knowledge',
    repository TEXT,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    content TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    title, tags, content, content='', content_rowid='rowid',
    tokenize='porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL
  );
`;

export function openDb(config: Config): DB {
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.function('regexp', (pattern: string, value: string) => {
    const flagMatch = pattern.match(/^\(\?([a-z]+)\)/);
    const flags = flagMatch ? flagMatch[1] : '';
    const re = flagMatch ? pattern.slice(flagMatch[0].length) : pattern;
    return new RegExp(re, flags).test(value) ? 1 : 0;
  });
  return db;
}

export function upsertMemoryChecked(
  db: DB,
  mem: {
    id: string;
    title: string;
    tags: string[];
    type: string;
    repository?: string;
    created: string;
    updated: string;
    content: string;
    filePath: string;
    contentHash: string;
  },
): void {
  db.transaction(() => {
    const existing = get<{
      rowid: number;
      title: string;
      tags: string;
      content: string;
    }>(
      db,
      SQL`SELECT rowid, title, tags, content FROM memories WHERE id = ${mem.id}`,
    );

    if (existing) {
      run(
        db,
        SQL`INSERT INTO memories_fts(memories_fts, rowid, title, tags, content)
            VALUES('delete', ${existing.rowid}, ${existing.title}, ${existing.tags}, ${existing.content})`,
      );
    }

    const tagsStr = mem.tags.join(',');
    run(
      db,
      SQL`INSERT INTO memories (id, title, tags, type, repository, created, updated, content, file_path, content_hash)
          VALUES (${mem.id}, ${mem.title}, ${tagsStr}, ${mem.type}, ${mem.repository ?? null}, ${mem.created}, ${mem.updated}, ${mem.content}, ${mem.filePath}, ${mem.contentHash})
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, tags=excluded.tags, type=excluded.type,
            repository=excluded.repository, updated=excluded.updated,
            content=excluded.content, file_path=excluded.file_path,
            content_hash=excluded.content_hash`,
    );

    const row = get<{ rowid: number }>(
      db,
      SQL`SELECT rowid FROM memories WHERE id = ${mem.id}`,
    )!;
    run(
      db,
      SQL`INSERT INTO memories_fts(rowid, title, tags, content)
          VALUES(${row.rowid}, ${mem.title}, ${tagsStr}, ${mem.content})`,
    );
  })();
}

export function deleteMemoryFromDb(db: DB, id: string): void {
  db.transaction(() => {
    const existing = get<{
      rowid: number;
      title: string;
      tags: string;
      content: string;
    }>(
      db,
      SQL`SELECT rowid, title, tags, content FROM memories WHERE id = ${id}`,
    );

    if (existing) {
      run(
        db,
        SQL`INSERT INTO memories_fts(memories_fts, rowid, title, tags, content)
            VALUES('delete', ${existing.rowid}, ${existing.title}, ${existing.tags}, ${existing.content})`,
      );
      run(db, SQL`DELETE FROM memories WHERE id = ${id}`);
    }
  })();
}

export function searchFts(
  db: DB,
  query: string,
  limit = 20,
): Array<{ id: string; score: number }> {
  const ftsQuery = escapeFtsQuery(query);
  const rows = all<{ id: string; rank: number }>(
    db,
    SQL`SELECT m.id, rank
        FROM memories_fts f
        JOIN memories m ON m.rowid = f.rowid
        WHERE memories_fts MATCH ${ftsQuery}
        ORDER BY rank
        LIMIT ${limit}`,
  );

  if (rows.length === 0) return [];
  const best = Math.abs(rows[0].rank) || 1;
  return rows.map((r) => ({
    id: r.id,
    score: Math.abs(r.rank) / best,
  }));
}

function escapeFtsQuery(query: string): string {
  const tokens = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`);
  return tokens.length > 1 ? tokens.join(' OR ') : (tokens[0] ?? '');
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

export function getMemoryById(
  db: DB,
  id: string,
): { file_path: string } | undefined {
  return get(db, SQL`SELECT file_path FROM memories WHERE id = ${id}`);
}

export function getMemoryByPrefix(
  db: DB,
  prefix: string,
): { file_path: string; id: string } | undefined {
  const escaped = escapeLike(prefix);
  const rows = all<{ id: string; file_path: string }>(
    db,
    SQL`SELECT id, file_path FROM memories WHERE id LIKE ${escaped + '%'} ESCAPE '\\'`,
  );
  return rows.length === 1 ? rows[0] : undefined;
}

export function getMemoryByFilename(
  db: DB,
  filename: string,
): { file_path: string } | undefined {
  const escaped = escapeLike(filename);
  return get(
    db,
    SQL`SELECT file_path FROM memories WHERE file_path LIKE ${'%/' + escaped} ESCAPE '\\'`,
  );
}

export function getAllMemoryIds(db: DB): Set<string> {
  const rows = all<{ id: string }>(db, SQL`SELECT id FROM memories`);
  return new Set(rows.map((r) => r.id));
}

export function getContentHash(db: DB, id: string): string | undefined {
  const row = get<{ content_hash: string }>(
    db,
    SQL`SELECT content_hash FROM memories WHERE id = ${id}`,
  );
  return row?.content_hash;
}

export function grepMemories(
  db: DB,
  pattern: string,
  limit = 20,
  ignoreCase = false,
  regex = false,
): Array<{ id: string; file_path: string }> {
  if (regex) {
    const re = ignoreCase ? `(?i)${pattern}` : pattern;
    return all(
      db,
      SQL`SELECT id, file_path FROM memories
          WHERE content REGEXP ${re}
             OR title REGEXP ${re}
          LIMIT ${limit}`,
    );
  }
  const escaped = escapeLike(pattern);
  const like = `%${escaped}%`;
  if (ignoreCase) {
    return all(
      db,
      SQL`SELECT id, file_path FROM memories
          WHERE (content LIKE ${like} ESCAPE '\\' COLLATE NOCASE)
             OR (title LIKE ${like} ESCAPE '\\' COLLATE NOCASE)
          LIMIT ${limit}`,
    );
  }
  return all(
    db,
    SQL`SELECT id, file_path FROM memories
        WHERE (content LIKE ${like} ESCAPE '\\')
           OR (title LIKE ${like} ESCAPE '\\')
        LIMIT ${limit}`,
  );
}

export function getEmbeddingCount(db: DB): number {
  const row = get<{ count: number }>(
    db,
    SQL`SELECT COUNT(*) as count FROM embeddings`,
  );
  return row?.count ?? 0;
}

export function getAllEmbeddings(
  db: DB,
): Array<{ id: string; embedding: Buffer }> {
  return all(db, SQL`SELECT id, embedding FROM embeddings`);
}

export function upsertEmbedding(
  db: DB,
  id: string,
  embedding: Buffer,
  model: string,
  dimensions: number,
): void {
  run(
    db,
    SQL`INSERT INTO embeddings (id, embedding, model, dimensions)
        VALUES (${id}, ${embedding}, ${model}, ${dimensions})
        ON CONFLICT(id) DO UPDATE SET
          embedding=excluded.embedding, model=excluded.model, dimensions=excluded.dimensions`,
  );
}

export function clearDb(db: DB): void {
  db.exec('DELETE FROM embeddings');
  db.exec('DELETE FROM memories');
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('delete-all')");
}
