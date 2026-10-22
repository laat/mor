import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import { LocalOperations } from './operations-local.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let ops: LocalOperations;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-ops-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();
  ops = new LocalOperations(config);
});

afterEach(() => {
  ops.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
});

describe('add', () => {
  it('creates a note and indexes it', async () => {
    const note = await ops.add({ title: 'Test', content: 'hello' });
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.title).toBe('Test');
    expect(note.content).toBe('hello');
    expect(fs.existsSync(note.filePath)).toBe(true);
  });

  it('sets default type to knowledge', async () => {
    const note = await ops.add({ title: 'Default Type', content: 'x' });
    expect(note.type).toBe('knowledge');
  });

  it('sets tags and type', async () => {
    const note = await ops.add({
      title: 'Tagged',
      content: 'x',
      tags: ['a', 'b'],
      type: 'snippet',
    });
    expect(note.tags).toEqual(['a', 'b']);
    expect(note.type).toBe('snippet');
  });

  it('sets description', async () => {
    const note = await ops.add({
      title: 'Described',
      content: 'x',
      description: 'A desc',
    });
    expect(note.description).toBe('A desc');
  });

  it('sets repository', async () => {
    const note = await ops.add({
      title: 'Repo',
      content: 'x',
      repository: 'github.com/org/repo',
    });
    expect(note.repository).toBe('github.com/org/repo');
  });

  it('is immediately searchable', async () => {
    await ops.add({ title: 'Searchable', content: 'indexed content' });
    const page = await ops.search('indexed');
    expect(page.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('read', () => {
  it('resolves by full UUID', async () => {
    const note = await ops.add({ title: 'UUID Read', content: 'x' });
    const found = await ops.read(note.id);
    expect(found?.id).toBe(note.id);
  });

  it('resolves by UUID prefix (8 chars)', async () => {
    const note = await ops.add({ title: 'Prefix Read', content: 'x' });
    const found = await ops.read(note.id.slice(0, 8));
    expect(found?.id).toBe(note.id);
  });

  it('resolves by filename', async () => {
    const note = await ops.add({ title: 'Filename Read', content: 'x' });
    const found = await ops.read(path.basename(note.filePath));
    expect(found?.id).toBe(note.id);
  });

  it('resolves by FTS search', async () => {
    await ops.add({
      title: 'Unique Quantum Computing',
      content: 'quantum entanglement',
    });
    const found = await ops.read('quantum');
    expect(found?.title).toBe('Unique Quantum Computing');
  });

  it('returns undefined for non-existent', async () => {
    const found = await ops.read('nonexistent-thing-12345');
    expect(found).toBeUndefined();
  });
});

describe('update', () => {
  it('updates content', async () => {
    const note = await ops.add({ title: 'Update Me', content: 'old' });
    const updated = await ops.update(note.id, { content: 'new' });
    expect(updated.content).toBe('new');
    expect(updated.id).toBe(note.id);
  });

  it('updates title', async () => {
    const note = await ops.add({ title: 'Old Title', content: 'x' });
    const updated = await ops.update(note.id, { title: 'New Title' });
    expect(updated.title).toBe('New Title');
  });

  it('updates tags', async () => {
    const note = await ops.add({
      title: 'Tag Update',
      content: 'x',
      tags: ['a'],
    });
    const updated = await ops.update(note.id, { tags: ['b', 'c'] });
    expect(updated.tags).toEqual(['b', 'c']);
  });

  it('updates description', async () => {
    const note = await ops.add({ title: 'Desc Update', content: 'x' });
    const updated = await ops.update(note.id, { description: 'new desc' });
    expect(updated.description).toBe('new desc');
  });

  it('updates type', async () => {
    const note = await ops.add({ title: 'Type Update', content: 'x' });
    const updated = await ops.update(note.id, { type: 'snippet' });
    expect(updated.type).toBe('snippet');
  });

  it('updates timestamp', async () => {
    const note = await ops.add({ title: 'Time Update', content: 'x' });
    const updated = await ops.update(note.id, { content: 'y' });
    expect(updated.updated >= note.updated).toBe(true);
  });

  it('accepts UUID prefix', async () => {
    const note = await ops.add({ title: 'Prefix Update', content: 'x' });
    const updated = await ops.update(note.id.slice(0, 8), { content: 'y' });
    expect(updated.id).toBe(note.id);
  });

  it('rejects non-UUID query', async () => {
    await ops.add({ title: 'Strict Test', content: 'x' });
    await expect(ops.update('Strict Test', { content: 'y' })).rejects.toThrow(
      'not found',
    );
  });

  it('throws on non-existent ID', async () => {
    await expect(
      ops.update('00000000-0000-0000-0000-000000000000', { content: 'x' }),
    ).rejects.toThrow('not found');
  });
});

describe('remove', () => {
  it('deletes note and file', async () => {
    const note = await ops.add({ title: 'Delete Me', content: 'bye' });
    const result = await ops.remove(note.id);
    expect(result.title).toBe('Delete Me');
    expect(result.id).toBe(note.id);
    expect(fs.existsSync(note.filePath)).toBe(false);
  });

  it('removes from search index', async () => {
    const note = await ops.add({ title: 'Remove Index', content: 'gone' });
    await ops.remove(note.id);
    const found = await ops.read(note.id);
    expect(found).toBeUndefined();
  });

  it('accepts UUID prefix', async () => {
    const note = await ops.add({ title: 'Prefix Remove', content: 'x' });
    const result = await ops.remove(note.id.slice(0, 8));
    expect(result.id).toBe(note.id);
  });

  it('rejects non-UUID query', async () => {
    await ops.add({ title: 'Strict Remove', content: 'x' });
    await expect(ops.remove('Strict Remove')).rejects.toThrow('not found');
  });

  it('throws on non-existent ID', async () => {
    await expect(
      ops.remove('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('not found');
  });
});

describe('patch', () => {
  it('replaces a substring', async () => {
    const note = await ops.add({ title: 'Patch Me', content: 'hello world' });
    const updated = await ops.patch(note.id, 'world', 'universe');
    expect(updated.content).toBe('hello universe');
    expect(updated.id).toBe(note.id);
  });

  it('deletes text with empty new_str', async () => {
    const note = await ops.add({
      title: 'Delete Part',
      content: 'keep remove keep',
    });
    const updated = await ops.patch(note.id, ' remove', '');
    expect(updated.content).toBe('keep keep');
  });

  it('throws when old_str not found', async () => {
    const note = await ops.add({ title: 'No Match', content: 'hello' });
    await expect(ops.patch(note.id, 'missing', 'x')).rejects.toThrow(
      'old_str not found',
    );
  });

  it('throws when old_str appears multiple times', async () => {
    const note = await ops.add({ title: 'Multi', content: 'aaa' });
    await expect(ops.patch(note.id, 'a', 'b')).rejects.toThrow(
      'appears 3 times',
    );
  });

  it('works with UUID prefix query', async () => {
    const note = await ops.add({ title: 'Prefix Patch', content: 'old text' });
    const updated = await ops.patch(note.id.slice(0, 8), 'old', 'new');
    expect(updated.content).toBe('new text');
  });

  it('throws on non-existent note', async () => {
    await expect(
      ops.patch('00000000-0000-0000-0000-000000000000', 'a', 'b'),
    ).rejects.toThrow('not found');
  });
});

describe('search', () => {
  it('finds by FTS', async () => {
    await ops.add({
      title: 'JavaScript Guide',
      content: 'Learn JavaScript basics',
      tags: ['javascript'],
    });
    await ops.add({
      title: 'Python Guide',
      content: 'Learn Python basics',
      tags: ['python'],
    });

    const page = await ops.search('JavaScript');
    expect(page.data.length).toBeGreaterThanOrEqual(1);
    expect(page.data[0].note.title).toBe('JavaScript Guide');
  });

  it('returns paginated result', async () => {
    await ops.add({ title: 'Page A', content: 'searchable alpha' });
    await ops.add({ title: 'Page B', content: 'searchable beta' });

    const page = await ops.search('searchable', 10);
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(2);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(10);
  });

  it('supports offset', async () => {
    await ops.add({ title: 'Off A', content: 'paginate this' });
    await ops.add({ title: 'Off B', content: 'paginate this' });

    const page = await ops.search('paginate', 1, undefined, 1);
    expect(page.data).toHaveLength(1);
    expect(page.offset).toBe(1);
  });

  it('ranks title matches higher than content', async () => {
    await ops.add({ title: 'Unrelated Title', content: 'typescript patterns' });
    await ops.add({ title: 'TypeScript Guide', content: 'some guide' });

    const page = await ops.search('typescript');
    expect(page.data[0].note.title).toBe('TypeScript Guide');
  });

  it('returns empty for no matches', async () => {
    const page = await ops.search('nonexistent-xyzzy');
    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('filters by tag', async () => {
    await ops.add({ title: 'Tagged A', content: 'test', tags: ['alpha'] });
    await ops.add({ title: 'Tagged B', content: 'test', tags: ['beta'] });

    const page = await ops.search('test', 20, { tag: ['alpha'] });
    expect(page.data.every((r) => r.note.tags.includes('alpha'))).toBe(true);
  });

  it('filters by type', async () => {
    await ops.add({ title: 'Snippet', content: 'code', type: 'snippet' });
    await ops.add({ title: 'Knowledge', content: 'code' });

    const page = await ops.search('code', 20, { type: 'snippet' });
    expect(page.data.every((r) => r.note.type === 'snippet')).toBe(true);
  });

  it('finds filtered matches beyond the initial candidate buffer', async () => {
    for (let i = 0; i < 60; i++) {
      await ops.add({
        title: `Common Knowledge ${i}`,
        content: 'common-filter-term',
      });
    }
    await ops.add({
      title: 'Common Snippet',
      content: 'common-filter-term',
      type: 'snippet',
    });

    const page = await ops.search('common-filter-term', 5, {
      type: 'snippet',
    });
    expect(page.total).toBe(1);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].note.title).toBe('Common Snippet');
  });

  it('resolves by full UUID', async () => {
    const note = await ops.add({ title: 'By ID', content: 'find me by id' });
    const page = await ops.search(note.id);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].note.id).toBe(note.id);
    expect(page.data[0].score).toBe(1);
  });

  it('resolves by UUID prefix', async () => {
    const note = await ops.add({
      title: 'By Prefix',
      content: 'find me by prefix',
    });
    const prefix = note.id.slice(0, 8);
    const page = await ops.search(prefix);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].note.id).toBe(note.id);
  });

  it('applies filter when resolving by ID', async () => {
    const note = await ops.add({
      title: 'Filtered ID',
      content: 'filter test',
      type: 'snippet',
    });
    const noMatch = await ops.search(note.id, 20, { type: 'knowledge' });
    expect(noMatch.data).toHaveLength(0);

    const match = await ops.search(note.id, 20, { type: 'snippet' });
    expect(match.data).toHaveLength(1);
  });
});

describe('grep', () => {
  it('finds literal substring', async () => {
    await ops.add({ title: 'Grep Hit', content: 'findme-exact-string' });
    await ops.add({ title: 'Grep Miss', content: 'nothing here' });

    const page = await ops.grep('findme-exact');
    expect(page.data).toHaveLength(1);
    expect(page.data[0].title).toBe('Grep Hit');
  });

  it('case-insensitive', async () => {
    await ops.add({ title: 'Case Test', content: 'MiXeDcAsE' });

    const page = await ops.grep('mixedcase', { ignoreCase: true });
    expect(page.data).toHaveLength(1);
  });

  it('case-sensitive by default', async () => {
    await ops.add({ title: 'Case Strict', content: 'OnlyThis' });

    const miss = await ops.grep('onlythis');
    expect(miss.data).toHaveLength(0);

    const hit = await ops.grep('OnlyThis');
    expect(hit.data).toHaveLength(1);
  });

  it('regex search', async () => {
    await ops.add({ title: 'Regex Hit', content: 'async function foo()' });
    await ops.add({ title: 'Regex Miss', content: 'const bar = 1' });

    const page = await ops.grep('async\\s+function', { regex: true });
    expect(page.data).toHaveLength(1);
    expect(page.data[0].title).toBe('Regex Hit');
  });

  it('regex case-insensitive', async () => {
    await ops.add({ title: 'Regex CI', content: 'ASYNC function bar()' });

    const page = await ops.grep('async\\s+function', {
      regex: true,
      ignoreCase: true,
    });
    expect(page.data).toHaveLength(1);
  });

  it('rejects invalid regex', async () => {
    await expect(ops.grep('[invalid', { regex: true })).rejects.toThrow(
      'Invalid regex',
    );
  });

  it('returns paginated result', async () => {
    await ops.add({ title: 'Grep A', content: 'common-token' });
    await ops.add({ title: 'Grep B', content: 'common-token' });

    const page = await ops.grep('common-token');
    expect(page.total).toBe(2);
    expect(page.offset).toBe(0);
  });

  it('supports offset', async () => {
    await ops.add({ title: 'Grep Off A', content: 'shared-val' });
    await ops.add({ title: 'Grep Off B', content: 'shared-val' });

    const page = await ops.grep('shared-val', { limit: 1, offset: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.offset).toBe(1);
  });

  it('searches title too', async () => {
    await ops.add({ title: 'findme-in-title', content: 'nothing' });

    const page = await ops.grep('findme-in-title');
    expect(page.data).toHaveLength(1);
  });

  it('filters by tag', async () => {
    await ops.add({ title: 'G A', content: 'shared', tags: ['yes'] });
    await ops.add({ title: 'G B', content: 'shared', tags: ['no'] });

    const page = await ops.grep('shared', { filter: { tag: ['yes'] } });
    expect(page.data).toHaveLength(1);
    expect(page.data[0].title).toBe('G A');
  });

  it('filters by type', async () => {
    await ops.add({
      title: 'G Snippet',
      content: 'shared-type',
      type: 'snippet',
    });
    await ops.add({ title: 'G Knowledge', content: 'shared-type' });

    const page = await ops.grep('shared-type', { filter: { type: 'snippet' } });
    expect(page.data).toHaveLength(1);
    expect(page.data[0].title).toBe('G Snippet');
  });

  it('finds filtered matches beyond the initial grep buffer', async () => {
    for (let i = 0; i < 60; i++) {
      await ops.add({
        title: `Grep Knowledge ${i}`,
        content: 'shared-grep-filter',
      });
    }
    await ops.add({
      title: 'Grep Snippet',
      content: 'shared-grep-filter',
      type: 'snippet',
    });

    const page = await ops.grep('shared-grep-filter', {
      limit: 5,
      filter: { type: 'snippet' },
    });
    expect(page.total).toBe(1);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].title).toBe('Grep Snippet');
  });
});

describe('list', () => {
  it('lists all notes', async () => {
    await ops.add({ title: 'List A', content: 'a' });
    await ops.add({ title: 'List B', content: 'b' });

    const page = await ops.list();
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(2);
  });

  it('returns paginated result', async () => {
    await ops.add({ title: 'P A', content: 'a' });
    await ops.add({ title: 'P B', content: 'b' });
    await ops.add({ title: 'P C', content: 'c' });

    const page = await ops.list(undefined, 2);
    expect(page.data).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);
  });

  it('supports offset', async () => {
    await ops.add({ title: 'O A', content: 'a' });
    await ops.add({ title: 'O B', content: 'b' });

    const page = await ops.list(undefined, 10, 1);
    expect(page.data).toHaveLength(1);
    expect(page.offset).toBe(1);
  });

  it('sorts by updated descending', async () => {
    const first = await ops.add({ title: 'First', content: 'a' });
    // Ensure different timestamp
    await ops.update(first.id, { content: 'a-updated' });
    await ops.add({ title: 'Second', content: 'b' });

    const page = await ops.list();
    // Second was added last, so it should be first in descending order
    // But First was updated after Second was created, so order depends on timing
    // Just verify both are present and sorted by updated
    expect(page.data).toHaveLength(2);
    expect(page.data[0].updated >= page.data[1].updated).toBe(true);
  });

  it('filters by type', async () => {
    await ops.add({ title: 'Snippet', content: 'x', type: 'snippet' });
    await ops.add({ title: 'Knowledge', content: 'y' });

    const page = await ops.list({ type: 'snippet' });
    expect(page.total).toBe(1);
    expect(page.data[0].title).toBe('Snippet');
  });

  it('filters by tag', async () => {
    await ops.add({ title: 'T A', content: 'x', tags: ['match'] });
    await ops.add({ title: 'T B', content: 'y', tags: ['other'] });

    const page = await ops.list({ tag: ['match'] });
    expect(page.total).toBe(1);
    expect(page.data[0].title).toBe('T A');
  });

  it('filters by multiple tags with AND logic', async () => {
    await ops.add({ title: 'Both', content: 'x', tags: ['alpha', 'beta'] });
    await ops.add({
      title: 'Only alpha',
      content: 'y',
      tags: ['alpha'],
    });
    await ops.add({ title: 'Only beta', content: 'z', tags: ['beta'] });

    const page = await ops.list({ tag: ['alpha', 'beta'] });
    expect(page.total).toBe(1);
    expect(page.data[0].title).toBe('Both');
  });

  it('returns empty when no notes', async () => {
    const page = await ops.list();
    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
  });
});

describe('reindex', () => {
  it('rebuilds the index', async () => {
    await ops.add({ title: 'Reindex A', content: 'a' });
    await ops.add({ title: 'Reindex B', content: 'b' });

    const result = await ops.reindex();
    expect(result.count).toBe(2);
  });

  it('returns undefined embedding when not configured', async () => {
    await ops.add({ title: 'No Embed', content: 'x' });
    const result = await ops.reindex();
    expect(result.embedding).toBeUndefined();
  });

  it('picks up external file changes', async () => {
    await ops.add({ title: 'External', content: 'original' });

    // Directly modify the file outside of ops
    const page = await ops.list();
    const note = page.data[0];
    const raw = fs.readFileSync(note.filePath, 'utf-8');
    fs.writeFileSync(note.filePath, raw.replace('original', 'modified'));

    await ops.reindex();
    const updated = await ops.read(note.id);
    expect(updated?.content).toBe('modified');
  });
});

describe('syncIndex', () => {
  it('detects externally added files', async () => {
    // Add a file directly to the notes dir
    const content = [
      '---',
      'id: 00000000-0000-0000-0000-000000000001',
      'title: External File',
      'tags: []',
      'type: knowledge',
      "created: '2026-01-01T00:00:00.000Z'",
      "updated: '2026-01-01T00:00:00.000Z'",
      '---',
      'External content',
    ].join('\n');
    fs.writeFileSync(path.join(config.notesDir, 'external-0000.md'), content);

    // Should be found after syncIndex triggers on read
    const found = await ops.read('00000000-0000-0000-0000-000000000001');
    expect(found?.title).toBe('External File');
  });

  it('detects externally deleted files', async () => {
    const note = await ops.add({ title: 'Will Vanish', content: 'x' });
    fs.unlinkSync(note.filePath);

    // Force sync and verify it's gone
    const page = await ops.list();
    expect(page.data.find((m) => m.id === note.id)).toBeUndefined();
  });
});

describe('archive', () => {
  it('moves the file to the archive folder and keeps the note', async () => {
    const note = await ops.add({ title: 'Old Plan', content: 'retired idea' });
    const archived = await ops.archive(note.id);

    expect(archived.archived).toBe(true);
    expect(archived.filePath).toBe(
      path.join(config.notesDir, 'archive', path.basename(note.filePath)),
    );
    expect(fs.existsSync(note.filePath)).toBe(false);
    expect(fs.readFileSync(archived.filePath, 'utf-8')).toContain(
      'retired idea',
    );

    const read = await ops.read(note.id.slice(0, 8));
    expect(read?.archived).toBe(true);
    expect(read?.content).toBe('retired idea');
  });

  it('leaves archived notes out of search, grep and list by default', async () => {
    const kept = await ops.add({ title: 'Kept Widget', content: 'widget' });
    const old = await ops.add({ title: 'Old Widget', content: 'widget' });
    await ops.archive(old.id);

    const ids = (notes: Array<{ id: string }>) => notes.map((n) => n.id);
    const search = await ops.search('widget');
    expect(ids(search.data.map((r) => r.note))).toEqual([kept.id]);
    expect(search.total).toBe(1);
    expect(ids((await ops.grep('widget')).data)).toEqual([kept.id]);
    expect(ids((await ops.list()).data)).toEqual([kept.id]);
  });

  it('returns archived notes with the archived filter', async () => {
    const kept = await ops.add({ title: 'Kept Widget', content: 'widget' });
    const old = await ops.add({ title: 'Old Widget', content: 'widget' });
    await ops.archive(old.id);

    const only = await ops.search('widget', 20, { archived: 'only' });
    expect(only.data.map((r) => r.note.id)).toEqual([old.id]);
    const all = await ops.search('widget', 20, { archived: 'include' });
    expect(all.data.map((r) => r.note.id).sort()).toEqual(
      [kept.id, old.id].sort(),
    );

    const grep = await ops.grep('widget', { filter: { archived: 'only' } });
    expect(grep.data.map((n) => n.id)).toEqual([old.id]);
    const list = await ops.list({ archived: 'include' });
    expect(list.total).toBe(2);
  });

  it('reads archive operators from the search query', async () => {
    const kept = await ops.add({ title: 'Kept Widget', content: 'widget' });
    const old = await ops.add({ title: 'Old Widget', content: 'widget' });
    await ops.archive(old.id);

    const only = await ops.search('is:archived widget');
    expect(only.data.map((r) => r.note.id)).toEqual([old.id]);
    const all = await ops.search('widget archived:include');
    expect(all.total).toBe(2);
    const listed = await ops.search('is:archived');
    expect(listed.data.map((r) => r.note.id)).toEqual([old.id]);
    expect(listed.data.map((r) => r.note.id)).not.toContain(kept.id);
  });

  it('unarchives back into the notes folder', async () => {
    const note = await ops.add({ title: 'Comeback', content: 'returns' });
    await ops.archive(note.id);
    const restored = await ops.unarchive(note.id);

    expect(restored.archived).toBe(false);
    expect(restored.filePath).toBe(note.filePath);
    expect((await ops.search('returns')).data[0].note.id).toBe(note.id);
  });

  it('is a no-op for a note already in that state', async () => {
    const note = await ops.add({ title: 'Steady', content: 'x' });
    expect((await ops.unarchive(note.id)).filePath).toBe(note.filePath);
    const archived = await ops.archive(note.id);
    expect((await ops.archive(note.id)).filePath).toBe(archived.filePath);
  });

  it('keeps an archived note archived when it is updated', async () => {
    const note = await ops.add({ title: 'Archived Edit', content: 'v1' });
    await ops.archive(note.id);
    const updated = await ops.update(note.id, {
      title: 'Archived Edit 2',
      content: 'v2',
    });
    expect(updated.archived).toBe(true);
    expect(path.dirname(updated.filePath)).toBe(
      path.join(config.notesDir, 'archive'),
    );
    expect((await ops.list()).total).toBe(0);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(
      ops.archive('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('Note not found');
  });

  it('picks up notes moved into the archive folder by hand', async () => {
    const note = await ops.add({ title: 'Hand Moved', content: 'moved' });
    const archiveDir = path.join(config.notesDir, 'archive');
    fs.mkdirSync(archiveDir);
    fs.renameSync(
      note.filePath,
      path.join(archiveDir, path.basename(note.filePath)),
    );

    // A new instance syncs the index on first read, like a new CLI process
    ops.close();
    ops = new LocalOperations(config);
    expect((await ops.search('moved')).total).toBe(0);
    const found = await ops.search('moved', 20, { archived: 'only' });
    expect(found.data[0].note.id).toBe(note.id);
  });

  it('keeps archived notes through a reindex', async () => {
    const note = await ops.add({ title: 'Reindexed', content: 'stays' });
    await ops.archive(note.id);
    await ops.reindex();
    expect((await ops.list()).total).toBe(0);
    expect((await ops.list({ archived: 'only' })).data[0].id).toBe(note.id);
  });
});

describe('search with embeddings', () => {
  let embedOps: LocalOperations;

  beforeEach(() => {
    ops.close();
    embedOps = new LocalOperations({
      ...config,
      embedding: {
        provider: 'openai',
        model: 'test-model',
        baseUrl: 'http://embeddings.test',
        dimensions: 3,
      },
    });
    ops = embedOps;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubEmbeddings() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] })),
      ),
    );
  }

  it('uses hybrid scoring when the provider responds', async () => {
    stubEmbeddings();
    await embedOps.add({ title: 'Embedded', content: 'vector content' });

    const page = await embedOps.search('vector');
    expect(page.scoring).toBe('hybrid');
    expect(page.data[0].note.title).toBe('Embedded');
  });

  it('falls back to FTS when the provider fails at query time', async () => {
    stubEmbeddings();
    await embedOps.add({ title: 'Embedded', content: 'vector content' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const page = await embedOps.search('vector');
    expect(page.scoring).toBe('fts');
    expect(page.data[0].note.title).toBe('Embedded');
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('falling back to FTS'),
    );
  });

  it('leaves archived notes out of hybrid results', async () => {
    stubEmbeddings();
    const kept = await embedOps.add({ title: 'Kept', content: 'vector one' });
    const old = await embedOps.add({ title: 'Old', content: 'vector two' });
    await embedOps.archive(old.id);

    const page = await embedOps.search('vector');
    expect(page.scoring).toBe('hybrid');
    expect(page.data.map((r) => r.note.id)).toEqual([kept.id]);
  });

  it('finds vector matches behind many closer archived notes', async () => {
    // Archived notes embed right on the query; the live note only nearby
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { input } = JSON.parse(init.body);
        const embedding = input.includes('nearby') ? [0.8, 0.6, 0] : [1, 0, 0];
        return new Response(JSON.stringify({ data: [{ embedding }] }));
      }),
    );
    const live = await embedOps.add({ title: 'Live', content: 'nearby' });
    const archived: string[] = [];
    for (let i = 0; i < 80; i++) {
      const note = await embedOps.add({ title: `Old ${i}`, content: 'exact' });
      await embedOps.archive(note.id);
      archived.push(note.id);
    }

    const page = await embedOps.search('query');
    expect(page.scoring).toBe('hybrid');
    expect(page.data.map((r) => r.note.id)).toEqual([live.id]);

    for (const id of archived) await embedOps.unarchive(id);
    await embedOps.archive(live.id);
    const only = await embedOps.search('query', 20, { archived: 'only' });
    expect(only.data.map((r) => r.note.id)).toEqual([live.id]);
  });
});
