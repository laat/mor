import type { Command } from 'commander';
import type { Memory, SearchResult } from './types.js';

export interface MemoryFilter {
  type?: string;
  tag?: string;
  repo?: string;
  ext?: string;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${withWildcards}$`, 'i');
}

function matchGlob(value: string, pattern: string): boolean {
  return globToRegex(pattern).test(value);
}

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

export function filterMemories(
  memories: Memory[],
  filter: MemoryFilter,
): Memory[] {
  if (!filter.type && !filter.tag && !filter.repo && !filter.ext)
    return memories;
  return memories.filter((mem) => matchMemory(mem, filter));
}

export function filterResults(
  results: SearchResult[],
  filter: MemoryFilter,
): SearchResult[] {
  if (!filter.type && !filter.tag && !filter.repo && !filter.ext)
    return results;
  return results.filter((r) => matchMemory(r.memory, filter));
}

export function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--type <type>', 'Filter by memory type (comma-separated, glob)')
    .option('--tag <pattern>', 'Filter by tag (glob)')
    .option('--repo <pattern>', 'Filter by repository (glob)')
    .option('--ext <ext>', 'Filter by file extension in title');
}
