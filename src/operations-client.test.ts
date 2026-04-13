import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { loadConfig } from './config.js';
import { RemoteOperations } from './operations-client.js';
import { startServer } from './operations-server.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let server: http.Server;
let ops: RemoteOperations;

beforeEach(async () => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-client-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();

  server = startServer(config, { port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  ops = new RemoteOperations({
    notesDir: '',
    dbPath: '',
    server: { url: baseUrl },
  });
});

afterEach(async () => {
  ops.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(testDir, { recursive: true });
  delete process.env.MOR_HOME;
});

describe('RemoteOperations client', () => {
  it('add + list returns paginated result', async () => {
    await ops.add({ title: 'Test A', content: 'aaa' });
    await ops.add({ title: 'Test B', content: 'bbb' });

    const page = await ops.list();
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(2);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(100);
  });

  it('search returns paginated result', async () => {
    await ops.add({
      title: 'TypeScript Guide',
      content: 'generics and types',
    });
    const page = await ops.search('typescript');
    expect(page.total).toBeGreaterThan(0);
    expect(page.data[0].note.title).toBe('TypeScript Guide');
    expect(page.data[0].score).toBeDefined();
    expect(page.offset).toBe(0);
  });

  it('grep returns paginated result', async () => {
    await ops.add({ title: 'Grep Test', content: 'findme here' });
    const page = await ops.grep('findme');
    expect(page.total).toBe(1);
    expect(page.data[0].title).toBe('Grep Test');
    expect(page.offset).toBe(0);
  });

  it('round-trip: add → search → read → update → remove', async () => {
    const note = await ops.add({
      title: 'Round Trip',
      content: 'initial',
      tags: ['test'],
    });

    const searchPage = await ops.search('round trip');
    expect(searchPage.data.length).toBeGreaterThan(0);

    const read = await ops.read(note.id);
    expect(read?.content).toBe('initial');

    const updated = await ops.update(note.id, { content: 'updated' });
    expect(updated.content).toBe('updated');

    const removed = await ops.remove(note.id);
    expect(removed.title).toBe('Round Trip');

    const gone = await ops.read(note.id);
    expect(gone).toBeUndefined();
  });

  it('reindex returns count and no embedding when not configured', async () => {
    await ops.add({ title: 'Reindex Test', content: 'x' });
    const result = await ops.reindex();
    expect(result.count).toBe(1);
    expect(result.embedding).toBeUndefined();
  });

  it('getLinks returns forward and backlinks', async () => {
    const target = await ops.add({ title: 'Target', content: 'target body' });
    await ops.add({
      title: 'Source',
      content: `See [Target](mor:${target.id})`,
    });

    const links = await ops.getLinks(target.id);
    expect(links.forward).toHaveLength(0);
    expect(links.back).toHaveLength(1);
    expect(links.back[0].title).toBe('Source');
  });

  it('getLinks returns forward links', async () => {
    const target = await ops.add({ title: 'Target', content: 'x' });
    const source = await ops.add({
      title: 'Source',
      content: `See [Target](mor:${target.id})`,
    });

    const links = await ops.getLinks(source.id);
    expect(links.forward).toHaveLength(1);
    expect(links.forward[0].title).toBe('Target');
    expect(links.back).toHaveLength(0);
  });

  it('getLinks returns empty arrays for note with no links', async () => {
    const note = await ops.add({ title: 'No Links', content: 'alone' });
    const links = await ops.getLinks(note.id);
    expect(links.forward).toHaveLength(0);
    expect(links.back).toHaveLength(0);
  });
});
