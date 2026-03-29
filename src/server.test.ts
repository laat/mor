import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { loadConfig } from './config.js';
import { startServer } from './server.js';
import type { Config } from './types.js';

let testDir: string;
let config: Config;
let server: http.Server;
let baseUrl: string;

async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(async () => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-server-test-'));
  process.env.MOR_HOME = testDir;
  config = loadConfig();

  server = startServer(config, { port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(testDir, { recursive: true });
  delete process.env.MOR_HOME;
});

describe('HTTP Server', () => {
  it('GET /health returns ok', async () => {
    const { status, json } = await req('GET', '/health');
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  it('POST /memories creates a memory', async () => {
    const { status, json } = await req('POST', '/memories', {
      title: 'Test Memory',
      content: 'Hello world',
      tags: ['test'],
    });
    expect(status).toBe(201);
    expect(json.data.title).toBe('Test Memory');
    expect(json.data.content).toBe('Hello world');
    expect(json.data.id).toBeDefined();
  });

  it('GET /memories lists memories', async () => {
    await req('POST', '/memories', { title: 'Mem A', content: 'aaa' });
    await req('POST', '/memories', { title: 'Mem B', content: 'bbb' });

    const { status, json } = await req('GET', '/memories');
    expect(status).toBe(200);
    expect(json.data).toHaveLength(2);
  });

  it('GET /memories/:id reads a memory by UUID', async () => {
    const { json: created } = await req('POST', '/memories', {
      title: 'Read Me',
      content: 'content here',
    });
    const id = created.data.id;

    const { status, json } = await req('GET', `/memories/${id}`);
    expect(status).toBe(200);
    expect(json.data.title).toBe('Read Me');
    expect(json.data.content).toBe('content here');
  });

  it('GET /memories/:prefix reads by UUID prefix', async () => {
    const { json: created } = await req('POST', '/memories', {
      title: 'Prefix Test',
      content: 'prefix content',
    });
    const prefix = created.data.id.slice(0, 8);

    const { status, json } = await req('GET', `/memories/${prefix}`);
    expect(status).toBe(200);
    expect(json.data.title).toBe('Prefix Test');
  });

  it('GET /memories/search?q=... searches memories', async () => {
    await req('POST', '/memories', {
      title: 'TypeScript Patterns',
      content: 'generics and types',
    });
    await req('POST', '/memories', {
      title: 'Cooking Recipe',
      content: 'pasta carbonara',
    });

    const { status, json } = await req('GET', '/memories/search?q=typescript');
    expect(status).toBe(200);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].memory.title).toBe('TypeScript Patterns');
  });

  it('PUT /memories/:id updates a memory', async () => {
    const { json: created } = await req('POST', '/memories', {
      title: 'Old Title',
      content: 'old content',
    });
    const id = created.data.id;

    const { status, json } = await req('PUT', `/memories/${id}`, {
      title: 'New Title',
      content: 'new content',
    });
    expect(status).toBe(200);
    expect(json.data.title).toBe('New Title');
    expect(json.data.content).toBe('new content');
  });

  it('DELETE /memories/:id removes a memory', async () => {
    const { json: created } = await req('POST', '/memories', {
      title: 'Delete Me',
      content: 'gone soon',
    });
    const id = created.data.id;

    const { status, json } = await req('DELETE', `/memories/${id}`);
    expect(status).toBe(200);
    expect(json.data.title).toBe('Delete Me');

    // Verify it's gone
    const { status: getStatus } = await req('GET', `/memories/${id}`);
    expect(getStatus).toBe(404);
  });

  it('returns 404 for unknown memory', async () => {
    const { status, json } = await req(
      'GET',
      '/memories/nonexistent-id-00000000',
    );
    expect(status).toBe(404);
    expect(json.error).toBeDefined();
  });

  it('returns 400 for missing title on POST', async () => {
    const { status } = await req('POST', '/memories', { content: 'no title' });
    expect(status).toBe(400);
  });

  it('round-trip: add → search → read → update → delete', async () => {
    // Add
    const { json: addRes } = await req('POST', '/memories', {
      title: 'Round Trip',
      content: 'initial content',
      tags: ['roundtrip'],
      type: 'test',
    });
    const id = addRes.data.id;

    // Search
    const { json: searchRes } = await req(
      'GET',
      '/memories/search?q=round+trip',
    );
    expect(searchRes.data.length).toBeGreaterThan(0);

    // Read
    const { json: readRes } = await req('GET', `/memories/${id}`);
    expect(readRes.data.content).toBe('initial content');

    // Update
    const { json: updateRes } = await req('PUT', `/memories/${id}`, {
      content: 'updated content',
    });
    expect(updateRes.data.content).toBe('updated content');

    // Verify update
    const { json: readRes2 } = await req('GET', `/memories/${id}`);
    expect(readRes2.data.content).toBe('updated content');

    // Delete
    await req('DELETE', `/memories/${id}`);
    const { status } = await req('GET', `/memories/${id}`);
    expect(status).toBe(404);
  });
});

describe('HTTP Server Auth', () => {
  let authServer: http.Server;
  let authUrl: string;

  beforeEach(async () => {
    authServer = startServer(config, {
      port: 0,
      host: '127.0.0.1',
      token: 'secret123',
    });
    await new Promise<void>((resolve) => authServer.once('listening', resolve));
    const addr = authServer.address() as { port: number };
    authUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => authServer.close(() => resolve()));
  });

  it('rejects requests without token', async () => {
    const res = await fetch(`${authUrl}/health`);
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid token', async () => {
    const res = await fetch(`${authUrl}/health`, {
      headers: { Authorization: 'Bearer secret123' },
    });
    expect(res.status).toBe(200);
  });
});
