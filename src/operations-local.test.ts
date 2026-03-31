import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  it('creates a memory and indexes it', async () => {
    const mem = await ops.add({ title: 'Test', content: 'hello' });
    expect(mem.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mem.title).toBe('Test');
    expect(mem.content).toBe('hello');
    expect(fs.existsSync(mem.filePath)).toBe(true);
  });

  it('sets default type to knowledge', async () => {
    const mem = await ops.add({ title: 'Default Type', content: 'x' });
    expect(mem.type).toBe('knowledge');
  });

  it('sets tags and type', async () => {
    const mem = await ops.add({
      title: 'Tagged',
      content: 'x',
      tags: ['a', 'b'],
      type: 'snippet',
    });
    expect(mem.tags).toEqual(['a', 'b']);
    expect(mem.type).toBe('snippet');
  });

  it('sets description', async () => {
    const mem = await ops.add({
      title: 'Described',
      content: 'x',
      description: 'A desc',
    });
    expect(mem.description).toBe('A desc');
  });

  it('sets repository', async () => {
    const mem = await ops.add({
      title: 'Repo',
      content: 'x',
      repository: 'github.com/org/repo',
    });
    expect(mem.repository).toBe('github.com/org/repo');
  });

  it('is immediately searchable', async () => {
    await ops.add({ title: 'Searchable', content: 'indexed content' });
    const page = await ops.search('indexed');
    expect(page.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('read', () => {
  it('resolves by full UUID', async () => {
    const mem = await ops.add({ title: 'UUID Read', content: 'x' });
    const found = await ops.read(mem.id);
    expect(found?.id).toBe(mem.id);
  });

  it('resolves by UUID prefix (8 chars)', async () => {
    const mem = await ops.add({ title: 'Prefix Read', content: 'x' });
    const found = await ops.read(mem.id.slice(0, 8));
    expect(found?.id).toBe(mem.id);
  });

  it('resolves by filename', async () => {
    const mem = await ops.add({ title: 'Filename Read', content: 'x' });
    const found = await ops.read(path.basename(mem.filePath));
    expect(found?.id).toBe(mem.id);
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
    const mem = await ops.add({ title: 'Update Me', content: 'old' });
    const updated = await ops.update(mem.id, { content: 'new' });
    expect(updated.content).toBe('new');
    expect(updated.id).toBe(mem.id);
  });

  it('updates title', async () => {
    const mem = await ops.add({ title: 'Old Title', content: 'x' });
    const updated = await ops.update(mem.id, { title: 'New Title' });
    expect(updated.title).toBe('New Title');
  });

  it('updates tags', async () => {
    const mem = await ops.add({
      title: 'Tag Update',
      content: 'x',
      tags: ['a'],
    });
    const updated = await ops.update(mem.id, { tags: ['b', 'c'] });
    expect(updated.tags).toEqual(['b', 'c']);
  });

  it('updates description', async () => {
    const mem = await ops.add({ title: 'Desc Update', content: 'x' });
    const updated = await ops.update(mem.id, { description: 'new desc' });
    expect(updated.description).toBe('new desc');
  });

  it('updates type', async () => {
    const mem = await ops.add({ title: 'Type Update', content: 'x' });
    const updated = await ops.update(mem.id, { type: 'snippet' });
    expect(updated.type).toBe('snippet');
  });

  it('updates timestamp', async () => {
    const mem = await ops.add({ title: 'Time Update', content: 'x' });
    const updated = await ops.update(mem.id, { content: 'y' });
    expect(updated.updated).not.toBe(mem.updated);
  });

  it('accepts UUID prefix', async () => {
    const mem = await ops.add({ title: 'Prefix Update', content: 'x' });
    const updated = await ops.update(mem.id.slice(0, 8), { content: 'y' });
    expect(updated.id).toBe(mem.id);
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
  it('deletes memory and file', async () => {
    const mem = await ops.add({ title: 'Delete Me', content: 'bye' });
    const result = await ops.remove(mem.id);
    expect(result.title).toBe('Delete Me');
    expect(result.id).toBe(mem.id);
    expect(fs.existsSync(mem.filePath)).toBe(false);
  });

  it('removes from search index', async () => {
    const mem = await ops.add({ title: 'Remove Index', content: 'gone' });
    await ops.remove(mem.id);
    const found = await ops.read(mem.id);
    expect(found).toBeUndefined();
  });

  it('accepts UUID prefix', async () => {
    const mem = await ops.add({ title: 'Prefix Remove', content: 'x' });
    const result = await ops.remove(mem.id.slice(0, 8));
    expect(result.id).toBe(mem.id);
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
    expect(page.data[0].memory.title).toBe('JavaScript Guide');
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
    expect(page.data[0].memory.title).toBe('TypeScript Guide');
  });

  it('returns empty for no matches', async () => {
    const page = await ops.search('nonexistent-xyzzy');
    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('filters by tag', async () => {
    await ops.add({ title: 'Tagged A', content: 'test', tags: ['alpha'] });
    await ops.add({ title: 'Tagged B', content: 'test', tags: ['beta'] });

    const page = await ops.search('test', 20, { tag: 'alpha' });
    expect(page.data.every((r) => r.memory.tags.includes('alpha'))).toBe(true);
  });

  it('filters by type', async () => {
    await ops.add({ title: 'Snippet', content: 'code', type: 'snippet' });
    await ops.add({ title: 'Knowledge', content: 'code' });

    const page = await ops.search('code', 20, { type: 'snippet' });
    expect(page.data.every((r) => r.memory.type === 'snippet')).toBe(true);
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

    const page = await ops.grep('shared', { filter: { tag: 'yes' } });
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
});

describe('list', () => {
  it('lists all memories', async () => {
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
    await ops.add({ title: 'First', content: 'a' });
    await ops.add({ title: 'Second', content: 'b' });

    const page = await ops.list();
    expect(page.data[0].title).toBe('Second');
    expect(page.data[1].title).toBe('First');
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

    const page = await ops.list({ tag: 'match' });
    expect(page.total).toBe(1);
    expect(page.data[0].title).toBe('T A');
  });

  it('returns empty when no memories', async () => {
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

  it('picks up external file changes', async () => {
    await ops.add({ title: 'External', content: 'original' });

    // Directly modify the file outside of ops
    const page = await ops.list();
    const mem = page.data[0];
    const raw = fs.readFileSync(mem.filePath, 'utf-8');
    fs.writeFileSync(mem.filePath, raw.replace('original', 'modified'));

    await ops.reindex();
    const updated = await ops.read(mem.id);
    expect(updated?.content).toBe('modified');
  });
});

describe('syncIndex', () => {
  it('detects externally added files', async () => {
    // Add a file directly to the memory dir
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
    fs.writeFileSync(path.join(config.memoryDir, 'external-0000.md'), content);

    // Should be found after syncIndex triggers on read
    const found = await ops.read('00000000-0000-0000-0000-000000000001');
    expect(found?.title).toBe('External File');
  });

  it('detects externally deleted files', async () => {
    const mem = await ops.add({ title: 'Will Vanish', content: 'x' });
    fs.unlinkSync(mem.filePath);

    // Force sync and verify it's gone
    const page = await ops.list();
    expect(page.data.find((m) => m.id === mem.id)).toBeUndefined();
  });
});
