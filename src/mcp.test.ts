import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { loadConfig } from './config.js';
import { LocalOperations } from './operations-local.js';
import { startServer } from './operations-server.js';
import type { Config } from './operations.js';

let testDir: string;
let config: Config;
let ops: LocalOperations;
let server: http.Server;
let mcpUrl: string;
let sessionId: string;

let mcpId = 1;

async function mcpCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const id = mcpId++;
  const res = await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
  });
  const text = await res.text();
  // Parse SSE or JSON response
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.result) return data.result;
      if (data.error)
        throw new Error(data.error.message ?? JSON.stringify(data.error));
    }
  }
  const json = JSON.parse(text);
  if (json.result) return json.result;
  if (json.error)
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json;
}

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError?: boolean }> {
  const result = await mcpCall('tools/call', { name, arguments: args });
  return {
    text: result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n'),
    isError: result.isError,
  };
}

beforeEach(async () => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-mcp-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();
  ops = new LocalOperations(config);

  server = startServer(config, { port: 0, host: '127.0.0.1', mcp: true });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  mcpUrl = `http://127.0.0.1:${addr.port}`;

  // Initialize MCP session
  const initRes = await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
      id: 1,
    }),
  });
  sessionId = initRes.headers.get('mcp-session-id')!;

  // Send initialized notification
  await fetch(`${mcpUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
});

afterEach(async () => {
  await ops.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
});

describe('notes_create', () => {
  it('creates a memory', async () => {
    const { text } = await callTool('notes_create', {
      title: 'Test Memory',
      content: 'hello world',
    });
    expect(text).toContain('Created: Test Memory');
    expect(text).toContain('(');
  });

  it('creates with tags and type', async () => {
    const { text } = await callTool('notes_create', {
      title: 'Tagged',
      content: 'content',
      tags: ['a', 'b'],
      type: 'snippet',
    });
    expect(text).toContain('Tagged');
  });

  it('accepts null tags', async () => {
    const { text } = await callTool('notes_create', {
      title: 'Null Tags',
      content: 'content',
      tags: null,
    });
    expect(text).toContain('Null Tags');
  });
});

describe('notes_search', () => {
  it('finds memories by query', async () => {
    await ops.add({ title: 'JavaScript Guide', content: 'learn js' });
    await ops.add({ title: 'Python Guide', content: 'learn py' });

    const { text } = await callTool('notes_search', { query: 'javascript' });
    expect(text).toContain('JavaScript Guide');
    expect(text).toContain('Top result:');
  });

  it('returns no results message', async () => {
    const { text } = await callTool('notes_search', {
      query: 'nonexistent-xyzzy',
    });
    expect(text).toBe('No memories found.');
  });

  it('shows pagination header', async () => {
    await ops.add({ title: 'Search A', content: 'common' });
    await ops.add({ title: 'Search B', content: 'common' });

    const { text } = await callTool('notes_search', { query: 'common' });
    expect(text).toMatch(/Showing 1–2 of 2 results/);
  });

  it('respects limit and offset', async () => {
    await ops.add({ title: 'P1', content: 'paginated' });
    await ops.add({ title: 'P2', content: 'paginated' });
    await ops.add({ title: 'P3', content: 'paginated' });

    const { text } = await callTool('notes_search', {
      query: 'paginated',
      limit: 2,
      offset: 1,
    });
    expect(text).toMatch(/Showing 2–3 of 3 results/);
  });

  it('filters by tag', async () => {
    await ops.add({ title: 'Tagged', content: 'test', tags: ['yes'] });
    await ops.add({ title: 'Untagged', content: 'test' });

    const { text } = await callTool('notes_search', {
      query: 'test',
      tag: ['yes'],
    });
    expect(text).toContain('Tagged');
    expect(text).not.toContain('Untagged');
  });

  it('filters by type', async () => {
    await ops.add({ title: 'Snippet', content: 'code', type: 'snippet' });
    await ops.add({ title: 'Knowledge', content: 'code' });

    const { text } = await callTool('notes_search', {
      query: 'code',
      type: 'snippet',
    });
    expect(text).toContain('Snippet');
    expect(text).not.toContain('Knowledge');
  });
});

describe('notes_grep', () => {
  it('finds by substring', async () => {
    await ops.add({ title: 'Grep Hit', content: 'findme-exact' });
    await ops.add({ title: 'Grep Miss', content: 'nothing' });

    const { text } = await callTool('notes_grep', { pattern: 'findme-exact' });
    expect(text).toContain('Grep Hit');
    expect(text).toContain('Top result:');
    expect(text).not.toContain('Grep Miss');
  });

  it('case-insensitive', async () => {
    await ops.add({ title: 'CI Test', content: 'MiXeD' });

    const { text } = await callTool('notes_grep', {
      pattern: 'mixed',
      ignore_case: true,
    });
    expect(text).toContain('CI Test');
  });

  it('regex mode', async () => {
    await ops.add({ title: 'Regex Hit', content: 'async function foo()' });

    const { text } = await callTool('notes_grep', {
      pattern: 'async\\s+function',
      regex: true,
    });
    expect(text).toContain('Regex Hit');
  });

  it('filters by type', async () => {
    await ops.add({
      title: 'Grep Snippet',
      content: 'shared-grep',
      type: 'snippet',
    });
    await ops.add({ title: 'Grep Knowledge', content: 'shared-grep' });

    const { text } = await callTool('notes_grep', {
      pattern: 'shared-grep',
      type: 'snippet',
    });
    expect(text).toContain('Grep Snippet');
    expect(text).not.toContain('Grep Knowledge');
  });

  it('returns no results message', async () => {
    const { text } = await callTool('notes_grep', {
      pattern: 'nonexistent-xyzzy',
    });
    expect(text).toBe('No memories found.');
  });
});

describe('notes_read', () => {
  it('reads a single memory with separate metadata and content blocks', async () => {
    const mem = await ops.add({ title: 'Read Me', content: 'the content' });

    const { text } = await callTool('notes_read', { ids: [mem.id] });
    expect(text).toContain('title: Read Me');
    expect(text).toContain('the content');
  });

  it('includes description in metadata block', async () => {
    const mem = await ops.add({
      title: 'With Desc',
      description: 'A short summary',
      content: 'the body',
    });

    const { text } = await callTool('notes_read', { ids: [mem.id] });
    expect(text).toContain('title: With Desc');
    expect(text).toContain('description: A short summary');
    expect(text).toContain('the body');
  });

  it('batch reads multiple memories', async () => {
    const a = await ops.add({ title: 'Batch A', content: 'content a' });
    const b = await ops.add({ title: 'Batch B', content: 'content b' });

    const { text } = await callTool('notes_read', { ids: [a.id, b.id] });
    expect(text).toContain('title: Batch A');
    expect(text).toContain('title: Batch B');
  });

  it('reports not found IDs', async () => {
    const mem = await ops.add({ title: 'Exists', content: 'x' });
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const { text } = await callTool('notes_read', {
      ids: [mem.id, fakeId],
    });
    expect(text).toContain('title: Exists');
    expect(text).toContain(`Not found: ${fakeId}`);
  });

  it('returns error when all not found', async () => {
    const { text, isError } = await callTool('notes_read', {
      ids: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(isError).toBe(true);
    expect(text).toContain('Memory not found');
  });

  it('returns error for empty ids', async () => {
    const { isError } = await callTool('notes_read', { ids: [] });
    expect(isError).toBe(true);
  });
});

describe('notes_update', () => {
  it('updates content and shows diff', async () => {
    const mem = await ops.add({ title: 'Update Me', content: 'old' });

    const { text } = await callTool('notes_update', {
      id: mem.id,
      content: 'new',
    });
    expect(text).toContain('Updated: Update Me');
    expect(text).toContain('--- content diff ---');
  });

  it('reports no changes when fields match', async () => {
    const mem = await ops.add({ title: 'Same', content: 'same' });

    const { text } = await callTool('notes_update', {
      id: mem.id,
      content: 'same',
    });
    expect(text).toContain('No changes: Same');
    expect(text).toContain('fields match current values');
  });

  it('updates title', async () => {
    const mem = await ops.add({ title: 'Old Title', content: 'x' });

    const { text } = await callTool('notes_update', {
      id: mem.id,
      title: 'New Title',
    });
    expect(text).toContain('New Title');
  });

  it('updates tags', async () => {
    const mem = await ops.add({ title: 'Tag Test', content: 'x', tags: ['a'] });

    const { text } = await callTool('notes_update', {
      id: mem.id,
      tags: ['b', 'c'],
    });
    expect(text).toContain('[a] → [b, c]');
  });

  it('returns error for non-existent ID', async () => {
    const { text, isError } = await callTool('notes_update', {
      id: '00000000-0000-0000-0000-000000000000',
      content: 'x',
    });
    expect(isError).toBe(true);
    expect(text).toContain('not found');
  });
});

describe('notes_remove', () => {
  it('removes a memory', async () => {
    const mem = await ops.add({ title: 'Remove Me', content: 'bye' });

    const { text } = await callTool('notes_remove', { id: mem.id });
    expect(text).toContain('Removed: Remove Me');
  });

  it('returns error for non-existent ID', async () => {
    const { text, isError } = await callTool('notes_remove', {
      id: '00000000-0000-0000-0000-000000000000',
    });
    expect(isError).toBe(true);
    expect(text).toContain('not found');
  });
});

describe('notes_list', () => {
  it('uses short 8-char IDs in output', async () => {
    const mem = await ops.add({ title: 'Short ID Test', content: 'x' });
    const shortId = mem.id.slice(0, 8);

    const list = await callTool('notes_list', {});
    expect(list.text).toContain(shortId);
    expect(list.text).not.toContain(mem.id);

    const search = await callTool('notes_search', { query: 'Short ID' });
    expect(search.text).toContain(shortId);
    expect(search.text).not.toContain(mem.id);

    const grep = await callTool('notes_grep', { pattern: 'Short ID Test' });
    expect(grep.text).toContain(shortId);
    expect(grep.text).not.toContain(mem.id);
  });

  it('lists memories', async () => {
    await ops.add({ title: 'List A', content: 'a' });
    await ops.add({ title: 'List B', content: 'b' });

    const { text } = await callTool('notes_list', {});
    expect(text).toContain('List A');
    expect(text).toContain('List B');
    expect(text).toMatch(/Showing 1–2 of 2 results/);
  });

  it('filters by tag', async () => {
    await ops.add({ title: 'Yes', content: 'x', tags: ['match'] });
    await ops.add({ title: 'No', content: 'y', tags: ['other'] });

    const { text } = await callTool('notes_list', { tag: ['match'] });
    expect(text).toContain('Yes');
    expect(text).not.toContain('No');
  });

  it('filters by type', async () => {
    await ops.add({ title: 'Snippet', content: 'x', type: 'snippet' });
    await ops.add({ title: 'Knowledge', content: 'y' });

    const { text } = await callTool('notes_list', { type: 'snippet' });
    expect(text).toContain('Snippet');
    expect(text).not.toContain('Knowledge');
  });

  it('paginates', async () => {
    await ops.add({ title: 'P1', content: 'a' });
    await ops.add({ title: 'P2', content: 'b' });
    await ops.add({ title: 'P3', content: 'c' });

    const { text } = await callTool('notes_list', { limit: 2 });
    expect(text).toMatch(/Showing 1–2 of 3 results/);
  });

  it('returns empty message', async () => {
    const { text } = await callTool('notes_list', {});
    expect(text).toBe('No memories stored.');
  });
});

describe('cross-references', () => {
  it('shows forward links in notes_read', async () => {
    const target = await ops.add({ title: 'Target Note', content: 'target' });
    const source = await ops.add({
      title: 'Source Note',
      content: `Links to [target](mor:${target.id})`,
    });

    const { text } = await callTool('notes_read', { ids: [source.id] });
    expect(text).toContain('Links:');
    expect(text).toContain(`→ ${target.id.slice(0, 8)}  Target Note`);
  });

  it('shows backlinks in notes_read', async () => {
    const target = await ops.add({ title: 'Target Note', content: 'target' });
    await ops.add({
      title: 'Source Note',
      content: `Links to [target](mor:${target.id})`,
    });

    const { text } = await callTool('notes_read', { ids: [target.id] });
    expect(text).toContain('Links:');
    expect(text).toContain('← ');
    expect(text).toContain('Source Note');
  });

  it('omits links section when no links exist', async () => {
    const mem = await ops.add({ title: 'No Links', content: 'alone' });

    const { text } = await callTool('notes_read', { ids: [mem.id] });
    expect(text).not.toContain('Links:');
  });

  it('resolves short ID prefixes in links', async () => {
    const target = await ops.add({ title: 'Target', content: 'x' });
    const shortId = target.id.slice(0, 8);
    const source = await ops.add({
      title: 'Source',
      content: `See [target](mor:${shortId})`,
    });

    const { text } = await callTool('notes_read', { ids: [source.id] });
    expect(text).toContain('→');
    expect(text).toContain('Target');
  });

  it('shows bidirectional arrow for mutual links', async () => {
    const a = await ops.add({ title: 'Note A', content: 'placeholder' });
    const b = await ops.add({
      title: 'Note B',
      content: `Links to [Note A](mor:${a.id})`,
    });
    // Update A to link back to B
    await ops.update(a.id, {
      content: `Links to [Note B](mor:${b.id})`,
    });

    const { text } = await callTool('notes_read', { ids: [a.id] });
    expect(text).toContain('↔');
    expect(text).toContain('Note B');
    // Should not have separate → and ← for the same note
    expect(text).not.toContain('←');
  });

  it('shows broken forward links', async () => {
    const source = await ops.add({
      title: 'Broken',
      content: '[dead](mor:deadbeef)',
    });

    const { text } = await callTool('notes_read', { ids: [source.id] });
    expect(text).toContain('→ deadbeef  (not found)');
  });
});
