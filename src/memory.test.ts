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
import type { Config } from './operations.js';

let testDir: string;
let config: Config;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();
});

afterEach(() => {
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

