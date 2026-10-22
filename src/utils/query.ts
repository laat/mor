import { ARCHIVED_MODES, type ArchivedMode } from '../operations.js';

const ARCHIVED_TOKEN = /^(?:is:archived|archived:([a-z]+))$/i;

/**
 * Pulls archive operators out of a search query: `is:archived` (same as
 * `archived:only`), `archived:include` and `archived:exclude`. Other words
 * are left as they are.
 */
export function parseArchivedSyntax(query: string): {
  query: string;
  archived?: ArchivedMode;
} {
  let archived: ArchivedMode | undefined;
  const rest: string[] = [];
  for (const word of query.split(/\s+/).filter(Boolean)) {
    const m = ARCHIVED_TOKEN.exec(word);
    const mode = m && (m[1]?.toLowerCase() ?? 'only');
    if (mode && (ARCHIVED_MODES as readonly string[]).includes(mode)) {
      archived = mode as ArchivedMode;
    } else {
      rest.push(word);
    }
  }
  return archived ? { query: rest.join(' '), archived } : { query };
}
