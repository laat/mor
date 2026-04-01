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
    expect(out).toBe('No memories found.');
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
      content: 'aaa\nbbb\ntarget\nccc\nddd',
    });
    const out = mor('grep', '-A', '1', 'target');
    expect(out).toContain('target');
    expect(out).toContain('ccc');
    expect(out).not.toContain('bbb');
  });

  it('-B shows lines before match', async () => {
    await ops.add({
      title: 'Before Ctx',
      content: 'aaa\nbbb\ntarget\nccc\nddd',
    });
    const out = mor('grep', '-B', '1', 'target');
    expect(out).toContain('target');
    expect(out).toContain('bbb');
    expect(out).not.toContain('ccc');
  });

  it('-C shows lines before and after match', async () => {
    await ops.add({
      title: 'Full Ctx',
      content: 'aaa\nbbb\ntarget\nccc\nddd',
    });
    const out = mor('grep', '-C', '1', 'target');
    expect(out).toContain('bbb');
    expect(out).toContain('target');
    expect(out).toContain('ccc');
    expect(out).not.toContain('aaa');
    expect(out).not.toContain('ddd');
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
    expect(out).toBe('No memories found.');
  });

  it('rejects invalid regex', () => {
    const err = morFail('grep', '-E', '[invalid');
    expect(err).toContain('Invalid regex');
  });
});

describe('cat', () => {
  it('prints memory content', async () => {
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

  it('errors on missing memory', () => {
    const err = morFail('cat', 'nonexistent-xyzzy');
    expect(err).toContain('memory not found');
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

  it('lists all memories', () => {
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
    expect(out).toBe('No memories stored.');
  });
});

describe('update', () => {
  it('updates title', async () => {
    const mem = await ops.add({ title: 'Old Title', content: 'content' });
    const id = mem.id.slice(0, 8);
    const out = mor('update', id, '-t', 'New Title');
    expect(out).toContain('Updated:');
    expect(out).toContain('New Title');

    const cat = mor('cat', 'New Title');
    expect(cat).toBe('content');
  });

  it('updates tags', async () => {
    const mem = await ops.add({ title: 'Tag Update', content: 'content' });
    const id = mem.id.slice(0, 8);
    mor('update', id, '--tags', 'x,y,z');
    const ls = mor('ls', '--tag', 'x');
    expect(ls).toContain('Tag Update');
  });

  it('errors on missing memory', () => {
    const err = morFail('update', '00000000', '-t', 'Nope');
    expect(err).toContain('not found');
  });

  it('errors with no updates', async () => {
    const mem = await ops.add({ title: 'No Update', content: 'content' });
    const id = mem.id.slice(0, 8);
    const err = morFail('update', id);
    expect(err).toContain('no updates provided');
  });
});

describe('rm', () => {
  it('removes a memory', async () => {
    const mem = await ops.add({ title: 'Delete Me', content: 'gone soon' });
    const id = mem.id.slice(0, 8);
    const out = mor('rm', id);
    expect(out).toContain('Removed:');
    expect(out).toContain('Delete Me');

    const err = morFail('cat', id);
    expect(err).toContain('memory not found');
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
    mor('cp', 'Copy Me', dest);
    const content = fs.readFileSync(dest, 'utf-8');
    expect(content.trim()).toBe('copy this content');
  });
});

describe('reindex', () => {
  it('rebuilds the index', async () => {
    await ops.add({ title: 'Index Me', content: 'indexed' });
    const out = mor('reindex');
    expect(out).toMatch(/Reindexed \d+ memor/);
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
    expect(out).toBe('Imported 2 memories.');

    const ls = mor('ls');
    expect(ls).toContain('note1');
    expect(ls).toContain('note2');
  });
});
