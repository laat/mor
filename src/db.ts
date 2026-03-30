import Database from 'better-sqlite3';
import type { Config } from './operations.js';

export type DB = Database.Database;

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
    const existing = db
      .prepare('SELECT rowid, title, tags, content FROM memories WHERE id = ?')
      .get(mem.id) as
      | { rowid: number; title: string; tags: string; content: string }
      | undefined;

    if (existing) {
      db.prepare(
        "INSERT INTO memories_fts(memories_fts, rowid, title, tags, content) VALUES('delete', ?, ?, ?, ?)",
      ).run(existing.rowid, existing.title, existing.tags, existing.content);
    }

    const tagsStr = mem.tags.join(',');
    db.prepare(
      `INSERT INTO memories (id, title, tags, type, repository, created, updated, content, file_path, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, tags=excluded.tags, type=excluded.type,
         repository=excluded.repository, updated=excluded.updated,
         content=excluded.content, file_path=excluded.file_path,
         content_hash=excluded.content_hash`,
    ).run(
      mem.id,
      mem.title,
      tagsStr,
      mem.type,
      mem.repository ?? null,
      mem.created,
      mem.updated,
      mem.content,
      mem.filePath,
      mem.contentHash,
    );

    const row = db
      .prepare('SELECT rowid FROM memories WHERE id = ?')
      .get(mem.id) as { rowid: number };
    db.prepare(
      'INSERT INTO memories_fts(rowid, title, tags, content) VALUES(?, ?, ?, ?)',
    ).run(row.rowid, mem.title, tagsStr, mem.content);
  })();
}

export function deleteMemoryFromDb(db: DB, id: string): void {
  db.transaction(() => {
    const existing = db
      .prepare('SELECT rowid, title, tags, content FROM memories WHERE id = ?')
      .get(id) as
      | { rowid: number; title: string; tags: string; content: string }
      | undefined;

    if (existing) {
      db.prepare(
        "INSERT INTO memories_fts(memories_fts, rowid, title, tags, content) VALUES('delete', ?, ?, ?, ?)",
      ).run(existing.rowid, existing.title, existing.tags, existing.content);
      db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    }
  })();
}

export function searchFts(
  db: DB,
  query: string,
  limit = 20,
): Array<{ id: string; score: number }> {
  const rows = db
    .prepare(
      `SELECT m.id, rank
       FROM memories_fts f
       JOIN memories m ON m.rowid = f.rowid
       WHERE memories_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(escapeFtsQuery(query), limit) as Array<{ id: string; rank: number }>;

  // rank is negative (more negative = better match), normalize to relative 0-1 score
  if (rows.length === 0) return [];
  const best = Math.abs(rows[0].rank) || 1;
  return rows.map((r) => ({
    id: r.id,
    score: Math.abs(r.rank) / best,
  }));
}

function escapeFtsQuery(query: string): string {
  // Quote each token and join with OR for union search ranked by relevance
  // e.g. "retry-after" → '"retry-after"', "foo bar" → '"foo" OR "bar"'
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
  return db.prepare('SELECT file_path FROM memories WHERE id = ?').get(id) as
    | { file_path: string }
    | undefined;
}

export function getMemoryByPrefix(
  db: DB,
  prefix: string,
): { file_path: string; id: string } | undefined {
  const rows = db
    .prepare(
      "SELECT id, file_path FROM memories WHERE id LIKE ? || '%' ESCAPE '\\'",
    )
    .all(escapeLike(prefix)) as Array<{
    id: string;
    file_path: string;
  }>;
  return rows.length === 1 ? rows[0] : undefined;
}

export function getMemoryByFilename(
  db: DB,
  filename: string,
): { file_path: string } | undefined {
  return db
    .prepare(
      "SELECT file_path FROM memories WHERE file_path LIKE '%/' || ? ESCAPE '\\'",
    )
    .get(escapeLike(filename)) as { file_path: string } | undefined;
}

export function getAllMemoryIds(db: DB): Set<string> {
  const rows = db.prepare('SELECT id FROM memories').all() as Array<{
    id: string;
  }>;
  return new Set(rows.map((r) => r.id));
}

export function getContentHash(db: DB, id: string): string | undefined {
  const row = db
    .prepare('SELECT content_hash FROM memories WHERE id = ?')
    .get(id) as { content_hash: string } | undefined;
  return row?.content_hash;
}

export function grepMemories(
  db: DB,
  pattern: string,
  limit = 20,
  ignoreCase = false,
): Array<{ id: string; file_path: string }> {
  const escaped = escapeLike(pattern);
  const sql = ignoreCase
    ? `SELECT id, file_path FROM memories WHERE (content LIKE '%' || ? || '%' ESCAPE '\\' COLLATE NOCASE) OR (title LIKE '%' || ? || '%' ESCAPE '\\' COLLATE NOCASE) LIMIT ?`
    : `SELECT id, file_path FROM memories WHERE (content LIKE '%' || ? || '%' ESCAPE '\\') OR (title LIKE '%' || ? || '%' ESCAPE '\\') LIMIT ?`;
  return db.prepare(sql).all(escaped, escaped, limit) as Array<{
    id: string;
    file_path: string;
  }>;
}

export function clearDb(db: DB): void {
  db.exec('DELETE FROM embeddings');
  db.exec('DELETE FROM memories');
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('delete-all')");
}
