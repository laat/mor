import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import {
  createMemory,
  readMemory,
  updateMemory,
  deleteMemory,
  listMemoryFiles,
} from './memory.js';
import { LocalOperations } from './operations-local.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let ops: LocalOperations;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();
  ops = new LocalOperations(config);
});

afterEach(() => {
  ops.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
});

describe('createMemory', () => {
  it('creates a markdown file with frontmatter', () => {
    const { mem } = createMemory(config, {
      title: 'Test Memory',
      content: 'Hello world',
      tags: ['test', 'hello'],
      type: 'knowledge',
    });

    expect(mem.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mem.title).toBe('Test Memory');
    expect(mem.tags).toEqual(['test', 'hello']);
    expect(mem.content).toBe('Hello world');
    expect(fs.existsSync(mem.filePath)).toBe(true);

    const raw = fs.readFileSync(mem.filePath, 'utf-8');
    expect(raw).toContain('title: Test Memory');
    expect(raw).toContain('Hello world');
  });

  it('generates slug-based filename with hash', () => {
    const { mem } = createMemory(config, {
      title: 'My Great Memory',
      content: 'content',
    });
    const basename = path.basename(mem.filePath);
    expect(basename).toMatch(/^my-great-memory-[0-9a-f]{4}\.md$/);
  });
});

describe('readMemory', () => {
  it('parses frontmatter and content', () => {
    const { mem: created } = createMemory(config, {
      title: 'Read Test',
      content: 'Some content here',
      tags: ['a', 'b'],
    });

    const mem = readMemory(created.filePath);
    expect(mem.id).toBe(created.id);
    expect(mem.title).toBe('Read Test');
    expect(mem.tags).toEqual(['a', 'b']);
    expect(mem.content).toBe('Some content here');
  });
});

describe('updateMemory', () => {
  it('updates content and timestamp', () => {
    const { mem } = createMemory(config, {
      title: 'Update Test',
      content: 'old',
    });
    const { mem: updated } = updateMemory(mem.filePath, {
      content: 'new content',
    });
    expect(updated.content).toBe('new content');
    expect(updated.updated).not.toBe(mem.updated);
  });

  it('renames file when title changes', () => {
    const { mem } = createMemory(config, {
      title: 'Old Title',
      content: 'content',
    });
    const oldPath = mem.filePath;
    const { mem: updated } = updateMemory(mem.filePath, { title: 'New Title' });
    expect(updated.filePath).not.toBe(oldPath);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(updated.filePath)).toBe(true);
  });
});

describe('deleteMemory', () => {
  it('removes the file', () => {
    const { mem } = createMemory(config, {
      title: 'Delete Me',
      content: 'bye',
    });
    expect(fs.existsSync(mem.filePath)).toBe(true);
    deleteMemory(mem.filePath);
    expect(fs.existsSync(mem.filePath)).toBe(false);
  });
});

describe('listMemoryFiles', () => {
  it('lists all markdown files', () => {
    createMemory(config, { title: 'A', content: 'a' });
    createMemory(config, { title: 'B', content: 'b' });
    const files = listMemoryFiles(config);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });
});

describe('operations', () => {
  it('add indexes the memory', async () => {
    await ops.add({ title: 'Ops Test', content: 'indexed content' });
    const page = await ops.search('indexed');
    expect(page.data.length).toBeGreaterThanOrEqual(1);
  });

  it('remove deletes from index', async () => {
    const mem = await ops.add({ title: 'Will Delete', content: 'temp' });
    await ops.remove(mem.id);
    const found = await ops.read(mem.id);
    expect(found).toBeUndefined();
  });

  it('search finds memories by FTS', async () => {
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

  it('read resolves by full UUID', async () => {
    const mem = await ops.add({ title: 'UUID Test', content: 'content' });
    const found = await ops.read(mem.id);
    expect(found?.id).toBe(mem.id);
  });

  it('read resolves by UUID prefix', async () => {
    const mem = await ops.add({ title: 'Prefix Test', content: 'content' });
    const found = await ops.read(mem.id.slice(0, 8));
    expect(found?.id).toBe(mem.id);
  });

  it('read resolves by filename', async () => {
    const mem = await ops.add({ title: 'Filename Test', content: 'content' });
    const found = await ops.read(path.basename(mem.filePath));
    expect(found?.id).toBe(mem.id);
  });

  it('read resolves by search query', async () => {
    await ops.add({
      title: 'Unique Quantum Computing',
      content: 'quantum entanglement',
    });
    const found = await ops.read('quantum');
    expect(found?.title).toBe('Unique Quantum Computing');
  });

  it('read returns undefined for non-existent', async () => {
    const found = await ops.read('nonexistent-thing-12345');
    expect(found).toBeUndefined();
  });
});
