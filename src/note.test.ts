import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import {
  createNote,
  readNote,
  updateNote,
  deleteNote,
  listNoteFiles,
} from './note.js';
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

describe('createNote', () => {
  it('creates a markdown file with frontmatter', () => {
    const { note } = createNote(config, {
      title: 'Test Note',
      content: 'Hello world',
      tags: ['test', 'hello'],
      type: 'knowledge',
    });

    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.title).toBe('Test Note');
    expect(note.tags).toEqual(['test', 'hello']);
    expect(note.content).toBe('Hello world');
    expect(fs.existsSync(note.filePath)).toBe(true);

    const raw = fs.readFileSync(note.filePath, 'utf-8');
    expect(raw).toContain('title: Test Note');
    expect(raw).toContain('Hello world');
  });

  it('generates slug-based filename with hash', () => {
    const { note } = createNote(config, {
      title: 'My Great Note',
      content: 'content',
    });
    const basename = path.basename(note.filePath);
    expect(basename).toMatch(/^my-great-note-[0-9a-f]{4}\.md$/);
  });
});

describe('readNote', () => {
  it('parses frontmatter and content', () => {
    const { note: created } = createNote(config, {
      title: 'Read Test',
      content: 'Some content here',
      tags: ['a', 'b'],
    });

    const note = readNote(created.filePath);
    expect(note.id).toBe(created.id);
    expect(note.title).toBe('Read Test');
    expect(note.tags).toEqual(['a', 'b']);
    expect(note.content).toBe('Some content here');
  });
});

describe('updateNote', () => {
  it('updates content and timestamp', () => {
    const { note } = createNote(config, {
      title: 'Update Test',
      content: 'old',
    });
    const { note: updated } = updateNote(note.filePath, {
      content: 'new content',
    });
    expect(updated.content).toBe('new content');
    expect(updated.updated >= note.updated).toBe(true);
  });

  it('renames file when title changes', () => {
    const { note } = createNote(config, {
      title: 'Old Title',
      content: 'content',
    });
    const oldPath = note.filePath;
    const { note: updated } = updateNote(note.filePath, { title: 'New Title' });
    expect(updated.filePath).not.toBe(oldPath);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(updated.filePath)).toBe(true);
  });
});

describe('deleteNote', () => {
  it('removes the file', () => {
    const { note } = createNote(config, {
      title: 'Delete Me',
      content: 'bye',
    });
    expect(fs.existsSync(note.filePath)).toBe(true);
    deleteNote(note.filePath);
    expect(fs.existsSync(note.filePath)).toBe(false);
  });
});

describe('listNoteFiles', () => {
  it('lists all markdown files', () => {
    createNote(config, { title: 'A', content: 'a' });
    createNote(config, { title: 'B', content: 'b' });
    const files = listNoteFiles(config);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });
});
