import { readMemory } from "./memory.js";
import { getMemoryById, getMemoryByPrefix, getMemoryByFilename, searchFts, type DB } from "./db.js";
import { syncIndex } from "./index.js";
import type { Config, Memory } from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX_RE = /^[0-9a-f]{4,}$/i;

export function resolveQuery(config: Config, db: DB, query: string): Memory | undefined {
  syncIndex(config, db);

  // 1. Full UUID match
  if (UUID_RE.test(query)) {
    const row = getMemoryById(db, query);
    if (row) return readMemory(row.file_path);
  }

  // 2. UUID prefix match
  if (UUID_PREFIX_RE.test(query) && query.length >= 4) {
    const row = getMemoryByPrefix(db, query);
    if (row) return readMemory(row.file_path);
  }

  // 3. Exact filename match
  const byFilename = getMemoryByFilename(db, query);
  if (byFilename) return readMemory(byFilename.file_path);

  // Also try with .md extension
  if (!query.endsWith(".md")) {
    const byFilenameMd = getMemoryByFilename(db, query + ".md");
    if (byFilenameMd) return readMemory(byFilenameMd.file_path);
  }

  // 4. FTS search - return top result
  try {
    const results = searchFts(db, query, 1);
    if (results.length > 0) {
      const row = getMemoryById(db, results[0].id);
      if (row) return readMemory(row.file_path);
    }
  } catch {
    // FTS query syntax error - ignore
  }

  return undefined;
}
