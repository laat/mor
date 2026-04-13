import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import { LocalOperations } from './operations-local.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let ops: LocalOperations;
const cli = path.resolve('dist/cli.js');

beforeAll(() => {
  execFileSync(path.resolve('node_modules/.bin/tsc'), {
    encoding: 'utf-8',
    timeout: 30000,
  });
});

function mor(...args: string[]): string {
  return execFileSync('node', [cli, ...args], {
    env: { ...process.env, MOR_HOME: testDir },
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

function morStdin(input: string, ...args: string[]): string {
  return execFileSync('node', [cli, ...args], {
    env: { ...process.env, MOR_HOME: testDir },
    encoding: 'utf-8',
    input,
    timeout: 10000,
  }).trim();
}

function morFail(...args: string[]): string {
  try {
    execFileSync('node', [cli, ...args], {
      env: { ...process.env, MOR_HOME: testDir },
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    throw new Error('Expected command to fail');
  } catch (e: any) {
    return (e.stderr || e.stdout || e.message).trim();
  }
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-cli-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();
  ops = new LocalOperations(config);
});

afterEach(() => {
  ops.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
});

describe('version', () => {
  it('prints version', () => {
    const out = mor('version');
    expect(out).toMatch(/^mor \d+\.\d+\.\d+/);
  });
});

describe('add', () => {
  it('adds from stdin', () => {
    const out = morStdin('hello from stdin', 'add', '-t', 'Stdin Test');
    expect(out).toContain('Created:');
    expect(out).toContain('Stdin Test');
  });

  it('adds from file', () => {
    const tmpFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(tmpFile, 'file content here');
    const out = mor('add', tmpFile, '-t', 'File Test');
    expect(out).toContain('Created:');
    expect(out).toContain('File Test');
  });

  it('adds with tags and type', () => {
    const out = morStdin(
      'tagged content',
      'add',
      '-t',
      'Tagged',
      '--tags',
      'a,b',
      '--type',
      'snippet',
    );
    expect(out).toContain('Created:');
    expect(out).toContain('Tagged');
  });

  it('adds with description', () => {
    const out = morStdin(
      'some content',
      'add',
      '-t',
      'Described',
      '-d',
      'A short desc',
    );
    expect(out).toContain('Described');
  });

  it('requires title from stdin', () => {
    const err = morFail('add');
    expect(err).toBeTruthy();
  });

  it('preserves existing frontmatter in markdown files', async () => {
    const mdFile = path.join(testDir, 'doc.md');
    fs.writeFileSync(
      mdFile,
      '---\nauthor: Jane\nstatus: draft\n---\n\n# My Doc\n\nHello world\n',
    );
    mor('add', mdFile);
    const notes = (await ops.list()).data;
    expect(notes).toHaveLength(1);
    const note = await ops.read(notes[0].id);
    expect(note!.content).toContain('author: Jane');
    expect(note!.content).toContain('# My Doc');
  });
});

describe('find', () => {
  it('finds by full-text search', async () => {
    await ops.add({
      title: 'JavaScript Basics',
      content: 'Learn JavaScript fundamentals',
    });
    const out = mor('find', 'javascript');
    expect(out).toContain('JavaScript Basics');
  });

  it('returns no results message', () => {
    const out = mor('find', 'nonexistent-xyzzy');
    expect(out).toBe('No notes found.');
  });

  it('--json outputs array with content', async () => {
    await ops.add({
      title: 'JSON Test',
      content: 'json content here',
      tags: ['a', 'b'],
    });
    const out = mor('find', 'json', '--json');
    const results = JSON.parse(out);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'JSON Test',
      tags: ['a', 'b'],
      content: 'json content here',
    });
    expect(results[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof results[0].score).toBe('number');
  });

  it('--json returns empty array when no results', () => {
    const out = mor('find', 'nonexistent-xyzzy', '--json');
    expect(JSON.parse(out)).toEqual([]);
  });
});

describe('grep', () => {
  beforeEach(async () => {
    await ops.add({ title: 'Grep Target', content: 'findme-exact-string' });
  });

  it('finds literal substring and prints matching line', () => {
    const out = mor('grep', 'findme-exact');
    expect(out).toContain('Grep Target');
    expect(out).toContain('findme-exact-string');
  });

  it('case-insensitive grep', () => {
    const out = mor('grep', '-i', 'FINDME-EXACT');
    expect(out).toContain('Grep Target');
  });

  it('regex grep prints matching line', () => {
    const out = mor('grep', '-E', 'findme-\\w+');
    expect(out).toContain('Grep Target');
    expect(out).toContain('findme-exact-string');
  });

  it('-l shows only titles, no matching lines', () => {
    const out = mor('grep', '-l', 'findme-exact');
    expect(out).toContain('Grep Target');
    expect(out).not.toContain('findme-exact-string');
  });

  it('-n shows line numbers', async () => {
    await ops.add({
      title: 'Numbered',
      content: 'first\nsecond\nthird has target\nfourth',
    });
    const out = mor('grep', '-n', 'target');
    expect(out).toContain('Numbered');
    expect(out).toMatch(/3:.*third has target/);
  });

  it('-A shows lines after match', async () => {
    await ops.add({
      title: 'After Ctx',
      content: 'LINEONE\nLINETWO\ntarget\nLINETHREE\nLINEFOUR',
    });
    const out = mor('grep', '-A', '1', 'target');
    expect(out).toContain('target');
    expect(out).toContain('LINETHREE');
    expect(out).not.toContain('LINETWO');
  });

  it('-B shows lines before match', async () => {
    await ops.add({
      title: 'Before Ctx',
      content: 'LINEONE\nLINETWO\ntarget\nLINETHREE\nLINEFOUR',
    });
    const out = mor('grep', '-B', '1', 'target');
    expect(out).toContain('target');
    expect(out).toContain('LINETWO');
    expect(out).not.toContain('LINETHREE');
  });

  it('-C shows lines before and after match', async () => {
    await ops.add({
      title: 'Full Ctx',
      content: 'LINEONE\nLINETWO\ntarget\nLINETHREE\nLINEFOUR',
    });
    const out = mor('grep', '-C', '1', 'target');
    expect(out).toContain('LINETWO');
    expect(out).toContain('target');
    expect(out).toContain('LINETHREE');
    expect(out).not.toContain('LINEONE');
    expect(out).not.toContain('LINEFOUR');
  });

  it('-C merges overlapping context', async () => {
    await ops.add({
      title: 'Overlap',
      content: 'aaa\nmatch1\nbbb\nmatch2\nccc',
    });
    const out = mor('grep', '-C', '1', '-n', 'match');
    // Lines should appear once, merged, no separator between adjacent matches
    expect(out).toContain('1: aaa');
    expect(out).toContain('2:');
    expect(out).toContain('3:');
    expect(out).toContain('4:');
    expect(out).toContain('5:');
    expect(out).not.toContain('--');
  });

  it('word grep matches whole words only', async () => {
    await ops.add({
      title: 'Word Test',
      content: 'beer is good\nbeers are many',
    });
    const out = mor('grep', '-w', 'beer');
    expect(out).toContain('Word Test');
    expect(out).toContain('beer is good');
    expect(out).not.toContain('beers are many');
  });

  it('grep shows multiple matching lines', async () => {
    await ops.add({
      title: 'Multi Match',
      content: 'line one has foo\nline two is plain\nline three has foo too',
    });
    const out = mor('grep', 'foo');
    expect(out).toContain('Multi Match');
    expect(out).toContain('line one has foo');
    expect(out).toContain('line three has foo too');
    expect(out).not.toContain('line two is plain');
  });

  it('returns no results message', () => {
    const out = mor('grep', 'nonexistent-xyzzy');
    expect(out).toBe('No notes found.');
  });

  it('rejects invalid regex', () => {
    const err = morFail('grep', '-E', '[invalid');
    expect(err).toContain('Invalid regex');
  });
});

describe('cat', () => {
  it('prints note content', async () => {
    await ops.add({ title: 'Cat Test', content: 'cat content here' });
    const out = mor('cat', 'Cat Test');
    expect(out).toBe('cat content here');
  });

  it('prints with frontmatter when --raw', async () => {
    await ops.add({ title: 'Raw Test', content: 'raw content' });
    const out = mor('cat', '--raw', 'Raw Test');
    expect(out).toContain('---');
    expect(out).toContain('title: Raw Test');
    expect(out).toContain('raw content');
  });

  it('errors on missing note', () => {
    const err = morFail('cat', 'nonexistent-xyzzy');
    expect(err).toContain('note not found');
  });
});

describe('ls', () => {
  beforeEach(async () => {
    await ops.add({ title: 'Mem A', content: 'aaa', tags: ['alpha'] });
    await ops.add({
      title: 'Mem B',
      content: 'bbb',
      tags: ['beta'],
      type: 'snippet',
    });
  });

  it('lists all notes', () => {
    const out = mor('ls');
    expect(out).toContain('Mem A');
    expect(out).toContain('Mem B');
  });

  it('lists with limit', () => {
    const out = mor('ls', '--limit', '1');
    const lines = out.split('\n');
    expect(lines).toHaveLength(1);
  });

  it('lists with --long', () => {
    const out = mor('ls', '-l');
    expect(out).toContain('knowledge');
    expect(out).toContain('snippet');
  });

  it('lists tags with counts', () => {
    const out = mor('ls', '--tags');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('lists types with counts', () => {
    const out = mor('ls', '--types');
    expect(out).toContain('knowledge');
    expect(out).toContain('snippet');
  });

  it('filters by tag', () => {
    const out = mor('ls', '--tag', 'alpha');
    expect(out).toContain('Mem A');
    expect(out).not.toContain('Mem B');
  });

  it('filters by type', () => {
    const out = mor('ls', '--type', 'snippet');
    expect(out).not.toContain('Mem A');
    expect(out).toContain('Mem B');
  });

  it('shows empty message', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-empty-'));
    const out = execFileSync('node', [cli, 'ls'], {
      env: { ...process.env, MOR_HOME: emptyDir },
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    fs.rmSync(emptyDir, { recursive: true });
    expect(out).toBe('No notes stored.');
  });
});

describe('update', () => {
  it('updates title', async () => {
    const note = await ops.add({ title: 'Old Title', content: 'content' });
    const id = note.id.slice(0, 8);
    const out = mor('update', id, '-t', 'New Title');
    expect(out).toContain('Updated:');
    expect(out).toContain('New Title');

    const cat = mor('cat', 'New Title');
    expect(cat).toBe('content');
  });

  it('updates tags', async () => {
    const note = await ops.add({ title: 'Tag Update', content: 'content' });
    const id = note.id.slice(0, 8);
    mor('update', id, '--tags', 'x,y,z');
    const ls = mor('ls', '--tag', 'x');
    expect(ls).toContain('Tag Update');
  });

  it('errors on missing note', () => {
    const err = morFail('update', '00000000', '-t', 'Nope');
    expect(err).toContain('not found');
  });

  it('shows metadata diff on title change', async () => {
    const note = await ops.add({ title: 'Before Title', content: 'content' });
    const id = note.id.slice(0, 8);
    const out = mor('update', '-t', 'After Title', id);
    expect(out).toContain('Updated:');
    expect(out).toContain('title:');
    expect(out).toContain('Before Title');
    expect(out).toContain('After Title');
  });

  it('shows content diff on content change', async () => {
    const note = await ops.add({ title: 'Diff Test', content: 'old content' });
    const id = note.id.slice(0, 8);
    const tmpFile = path.join(testDir, 'new-content.txt');
    fs.writeFileSync(tmpFile, 'new content');
    const out = mor('update', '--content-from', tmpFile, id);
    expect(out).toContain('Updated:');
    expect(out).toContain('content diff');
  });

  it('reports no changes when values match', async () => {
    const note = await ops.add({
      title: 'Same',
      content: 'same',
      tags: ['a'],
    });
    const id = note.id.slice(0, 8);
    const out = mor('update', '--tags', 'a', id);
    expect(out).toContain('No changes:');
  });

  it('errors with no updates', async () => {
    const note = await ops.add({ title: 'No Update', content: 'content' });
    const id = note.id.slice(0, 8);
    const err = morFail('update', id);
    expect(err).toContain('no updates provided');
  });
});

describe('rm', () => {
  it('removes a note', async () => {
    const note = await ops.add({ title: 'Delete Me', content: 'gone soon' });
    const id = note.id.slice(0, 8);
    const out = mor('rm', id);
    expect(out).toContain('Removed:');
    expect(out).toContain('Delete Me');

    const err = morFail('cat', id);
    expect(err).toContain('note not found');
  });

  it('errors on missing id', () => {
    const err = morFail('rm', '00000000-0000-0000-0000-000000000000');
    expect(err).toContain('not found');
  });
});

describe('cp', () => {
  it('copies content to file', async () => {
    await ops.add({ title: 'Copy Me', content: 'copy this content' });
    const dest = path.join(testDir, 'output.txt');
    mor('cp', '-o', dest, 'Copy Me');
    const content = fs.readFileSync(dest, 'utf-8');
    expect(content.trim()).toBe('copy this content');
  });
});

describe('reindex', () => {
  it('rebuilds the index', async () => {
    await ops.add({ title: 'Index Me', content: 'indexed' });
    const out = mor('reindex');
    expect(out).toMatch(/Reindexed \d+ note/);
  });
});

describe('import', () => {
  it('imports markdown files from directory', () => {
    const importDir = path.join(testDir, 'import');
    fs.mkdirSync(importDir);
    fs.writeFileSync(path.join(importDir, 'note1.md'), 'First note');
    fs.writeFileSync(path.join(importDir, 'note2.md'), 'Second note');
    fs.writeFileSync(path.join(importDir, 'skip.txt'), 'Not markdown');

    const out = mor('import', importDir);
    expect(out).toBe('Imported 2 notes.');

    const ls = mor('ls');
    expect(ls).toContain('note1');
    expect(ls).toContain('note2');
  });
});
