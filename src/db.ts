import Database from 'better-sqlite3';
import sql, { join, raw, type Sql } from 'sql-template-tag';
import * as sqliteVec from 'sqlite-vec';
import type { Config } from './operations.js';

export type DB = Database.Database;

// Bridge: sql-template-strings → better-sqlite3
function get<T>(db: DB, query: Sql): T | undefined {
  return db.prepare(query.sql).get(...query.values) as T | undefined;
}
function all<T>(db: DB, query: Sql): T[] {
  return db.prepare(query.sql).all(...query.values) as T[];
}
function run(db: DB, query: Sql) {
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
    content_hash TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TEXT
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

  CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id)
  );
  CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
`;

const VEC_TABLE = 'embeddings_vec';

function hasVecTable(db: DB): boolean {
  return !!get<{ name: string }>(
    db,
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name=${VEC_TABLE}`,
  );
}

function vecTableDDL(dims: number): string {
  return `CREATE VIRTUAL TABLE ${VEC_TABLE} USING vec0(id TEXT PRIMARY KEY, embedding float[${dims}] distance_metric=cosine)`;
}

function ftsDelete(db: DB, id: string): void {
  const existing = get<{
    rowid: number;
    title: string;
    tags: string;
    content: string;
  }>(
    db,
    sql`SELECT rowid, title, tags, content FROM memories WHERE id = ${id}`,
  );
  if (existing) {
    run(
      db,
      sql`INSERT INTO memories_fts(memories_fts, rowid, title, tags, content)
          VALUES('delete', ${existing.rowid}, ${existing.title}, ${existing.tags}, ${existing.content})`,
    );
  }
}

function hasColumn(db: DB, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function migrate(db: DB): void {
  if (!hasColumn(db, 'memories', 'access_count')) {
    db.exec(
      `ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!hasColumn(db, 'memories', 'last_accessed')) {
    db.exec(`ALTER TABLE memories ADD COLUMN last_accessed TEXT`);
  }
}

export function openDb(config: Config): DB {
  const db = new Database(config.dbPath);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('case_sensitive_like = ON');
  db.exec(SCHEMA);
  migrate(db);
  if (config.embedding && config.embedding.provider !== 'none') {
    if (!hasVecTable(db)) {
      db.exec(vecTableDDL(config.embedding.dimensions));
    }
  }
  db.function(
    'regexp',
    (() => {
      const cache = new Map<string, RegExp>();
      return (pattern: string, value: string): number => {
        let re = cache.get(pattern);
        if (!re) {
          const flagMatch = pattern.match(/^\(\?([a-z]+)\)/);
          const flags = flagMatch ? flagMatch[1] : '';
          const src = flagMatch ? pattern.slice(flagMatch[0].length) : pattern;
          re = new RegExp(src, flags);
          if (cache.size >= 64) cache.clear();
          cache.set(pattern, re);
        }
        return re.test(value) ? 1 : 0;
      };
    })(),
  );
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
    ftsDelete(db, mem.id);

    const tagsStr = mem.tags.join(',');
    run(
      db,
      sql`INSERT INTO memories (id, title, tags, type, repository, created, updated, content, file_path, content_hash)
          VALUES (${mem.id}, ${mem.title}, ${tagsStr}, ${mem.type}, ${mem.repository ?? null}, ${mem.created}, ${mem.updated}, ${mem.content}, ${mem.filePath}, ${mem.contentHash})
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, tags=excluded.tags, type=excluded.type,
            repository=excluded.repository, updated=excluded.updated,
            content=excluded.content, file_path=excluded.file_path,
            content_hash=excluded.content_hash`,
    );

    const row = get<{ rowid: number }>(
      db,
      sql`SELECT rowid FROM memories WHERE id = ${mem.id}`,
    )!;
    run(
      db,
      sql`INSERT INTO memories_fts(rowid, title, tags, content)
          VALUES(${row.rowid}, ${mem.title}, ${tagsStr}, ${mem.content})`,
    );
  })();
}

export function deleteMemoryFromDb(db: DB, id: string): void {
  db.transaction(() => {
    ftsDelete(db, id);
    run(db, sql`DELETE FROM memories WHERE id = ${id}`);
  })();
}

export function searchFts(
  db: DB,
  query: string,
  limit = 20,
): Array<{ id: string; score: number }> {
  const tokens = ftsTokenize(query);
  // Try AND first for precise results, fall back to OR for broader matching.
  // Wrap in try/catch because FTS5 can throw on syntax errors (reserved words,
  // special chars that slip past quoting).  If AND throws, try OR; if OR also
  // throws, return empty results.
  let rows: Array<{ id: string; rank: number }> = [];
  try {
    rows = ftsMatch(db, ftsJoin(tokens, 'AND'), limit);
  } catch {
    // AND query failed — fall through to OR below
  }
  if (rows.length === 0 && tokens.length > 1) {
    try {
      rows = ftsMatch(db, ftsJoin(tokens, 'OR'), limit);
    } catch {
      return [];
    }
  }

  if (rows.length === 0) return [];
  const best = Math.abs(rows[0].rank) || 1;
  return rows.map((r) => ({
    id: r.id,
    score: Math.abs(r.rank) / best,
  }));
}

function ftsMatch(
  db: DB,
  ftsQuery: string,
  limit: number,
): Array<{ id: string; rank: number }> {
  if (!ftsQuery) return [];
  return all<{ id: string; rank: number }>(
    db,
    sql`SELECT m.id, bm25(memories_fts, 10.0, 5.0, 1.0) AS rank
        FROM memories_fts f
        JOIN memories m ON m.rowid = f.rowid
        WHERE memories_fts MATCH ${ftsQuery}
        ORDER BY rank
        LIMIT ${limit}`,
  );
}

function ftsTokenize(query: string): string[] {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`);
}

function ftsJoin(tokens: string[], op: 'AND' | 'OR'): string {
  return tokens.length > 1 ? tokens.join(` ${op} `) : (tokens[0] ?? '');
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

export function getMemoryById(
  db: DB,
  id: string,
): { file_path: string } | undefined {
  return get(db, sql`SELECT file_path FROM memories WHERE id = ${id}`);
}

export function getMemoryByPrefix(
  db: DB,
  prefix: string,
): { file_path: string; id: string } | undefined {
  const escaped = escapeLike(prefix);
  const rows = all<{ id: string; file_path: string }>(
    db,
    sql`SELECT id, file_path FROM memories WHERE id LIKE ${escaped + '%'} ESCAPE '\\'`,
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
    sql`SELECT file_path FROM memories WHERE file_path LIKE ${'%/' + escaped} ESCAPE '\\'`,
  );
}

export function recordAccess(db: DB, id: string): void {
  run(
    db,
    sql`UPDATE memories SET access_count = access_count + 1, last_accessed = ${new Date().toISOString()} WHERE id = ${id}`,
  );
}

export function getAccessCount(db: DB, id: string): number {
  const row = get<{ access_count: number }>(
    db,
    sql`SELECT access_count FROM memories WHERE id = ${id}`,
  );
  return row?.access_count ?? 0;
}

export function getMemoriesByIds(
  db: DB,
  ids: string[],
): Map<string, { file_path: string; access_count: number }> {
  if (ids.length === 0) return new Map();
  const rows = all<{ id: string; file_path: string; access_count: number }>(
    db,
    sql`SELECT id, file_path, access_count FROM memories WHERE id IN (${join(ids)})`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export function getAllMemoryIds(db: DB): Set<string> {
  const rows = all<{ id: string }>(db, sql`SELECT id FROM memories`);
  return new Set(rows.map((r) => r.id));
}

export function getAllContentHashes(db: DB): Map<string, string> {
  const rows = all<{ id: string; content_hash: string }>(
    db,
    sql`SELECT id, content_hash FROM memories`,
  );
  return new Map(rows.map((r) => [r.id, r.content_hash]));
}

export function grepMemories(
  db: DB,
  pattern: string,
  limit = 20,
  ignoreCase = false,
  regex = false,
): Array<{ id: string; file_path: string }> {
  if (regex) {
    try {
      new RegExp(pattern);
    } catch (e) {
      throw new Error(
        `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    const re = ignoreCase ? `(?i)${pattern}` : pattern;
    return all(
      db,
      sql`SELECT id, file_path FROM memories
          WHERE content REGEXP ${re}
             OR title REGEXP ${re}
          LIMIT ${limit}`,
    );
  }
  if (ignoreCase) {
    const lowerLike = `%${escapeLike(pattern.toLowerCase())}%`;
    return all(
      db,
      sql`SELECT id, file_path FROM memories
          WHERE (LOWER(content) LIKE ${lowerLike} ESCAPE '\\')
             OR (LOWER(title) LIKE ${lowerLike} ESCAPE '\\')
          LIMIT ${limit}`,
    );
  }
  const like = `%${escapeLike(pattern)}%`;
  return all(
    db,
    sql`SELECT id, file_path FROM memories
        WHERE (content LIKE ${like} ESCAPE '\\')
           OR (title LIKE ${like} ESCAPE '\\')
        LIMIT ${limit}`,
  );
}

export function searchVec(
  db: DB,
  queryEmbedding: number[],
  limit: number,
): Array<{ id: string; distance: number }> {
  // Raw prepare — sqlite-vec requires Buffer passed directly
  const buffer = Buffer.from(new Float32Array(queryEmbedding).buffer);
  return db
    .prepare(
      `SELECT id, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
    )
    .all(buffer, limit) as Array<{ id: string; distance: number }>;
}

export function getEmbeddingModel(db: DB): string | undefined {
  const row = get<{ model: string }>(
    db,
    sql`SELECT model FROM embeddings LIMIT 1`,
  );
  return row?.model;
}

export function getEmbeddingCount(db: DB): number {
  const row = get<{ count: number }>(
    db,
    sql`SELECT COUNT(*) as count FROM embeddings`,
  );
  return row?.count ?? 0;
}

export function getAllEmbeddings(
  db: DB,
): Array<{ id: string; embedding: Buffer }> {
  return all(db, sql`SELECT id, embedding FROM embeddings`);
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
    sql`INSERT INTO embeddings (id, embedding, model, dimensions)
        VALUES (${id}, ${embedding}, ${model}, ${dimensions})
        ON CONFLICT(id) DO UPDATE SET
          embedding=excluded.embedding, model=excluded.model, dimensions=excluded.dimensions`,
  );
  if (hasVecTable(db)) {
    run(db, sql`DELETE FROM ${raw(VEC_TABLE)} WHERE id = ${id}`);
    // Raw prepare for INSERT — sqlite-vec requires Buffer passed directly
    db.prepare(`INSERT INTO ${VEC_TABLE} (id, embedding) VALUES (?, ?)`).run(
      id,
      embedding,
    );
  }
}

export function clearDb(db: DB, config: Config): void {
  run(db, sql`DELETE FROM links`);
  run(db, sql`DELETE FROM embeddings`);
  if (hasVecTable(db)) run(db, sql`DROP TABLE ${raw(VEC_TABLE)}`);
  if (config.embedding && config.embedding.provider !== 'none') {
    db.exec(vecTableDDL(config.embedding.dimensions));
  }
  run(db, sql`DELETE FROM memories`);
  run(db, sql`INSERT INTO memories_fts(memories_fts) VALUES('delete-all')`);
}

// ---- Links ----

export function upsertLinks(
  db: DB,
  sourceId: string,
  targetIds: string[],
): void {
  run(db, sql`DELETE FROM links WHERE source_id = ${sourceId}`);
  for (const targetId of targetIds) {
    run(
      db,
      sql`INSERT OR IGNORE INTO links (source_id, target_id) VALUES (${sourceId}, ${targetId})`,
    );
  }
}

export function deleteLinks(db: DB, sourceId: string): void {
  run(db, sql`DELETE FROM links WHERE source_id = ${sourceId}`);
}

export function getForwardLinks(
  db: DB,
  sourceId: string,
): Array<{ id: string; title: string }> {
  return all(
    db,
    sql`SELECT l.target_id AS id, COALESCE(m.title, '') AS title
        FROM links l
        LEFT JOIN memories m ON m.id = l.target_id
        WHERE l.source_id = ${sourceId}`,
  );
}

export function getBacklinks(
  db: DB,
  targetId: string,
): Array<{ id: string; title: string }> {
  return all(
    db,
    sql`SELECT l.source_id AS id, m.title
        FROM links l
        JOIN memories m ON m.id = l.source_id
        WHERE l.target_id = ${targetId}`,
  );
}
