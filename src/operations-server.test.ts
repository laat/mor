import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
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
    expect(json.ok).toBe(true);
    expect(json.version).toBeDefined();
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

  it('returns 404 on PUT for non-existent memory', async () => {
    const { status, json } = await req(
      'PUT',
      '/memories/00000000-0000-0000-0000-000000000000',
      { content: 'x' },
    );
    expect(status).toBe(404);
    expect(json.error).toContain('not found');
  });

  it('returns 404 on DELETE for non-existent memory', async () => {
    const { status, json } = await req(
      'DELETE',
      '/memories/00000000-0000-0000-0000-000000000000',
    );
    expect(status).toBe(404);
    expect(json.error).toContain('not found');
  });

  it('returns JSON error for search failures', async () => {
    const { status } = await req('GET', '/memories/search');
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

describe('Memberberry Hook', () => {
  it('returns empty JSON for short prompts', async () => {
    const { status, json } = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-1',
      prompt: 'hi',
    });
    expect(status).toBe(200);
    expect(json).toEqual({});
  });

  it('returns empty JSON for slash commands', async () => {
    const { status, json } = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-1',
      prompt: '/commit push all changes',
    });
    expect(status).toBe(200);
    expect(json).toEqual({});
  });

  it('returns additionalContext with matching memories', async () => {
    await req('POST', '/memories', {
      title: 'TypeScript Generics Guide',
      description: 'How to use generics in TS',
      content: 'Generics allow you to write reusable typed functions',
    });

    const { status, json } = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-2',
      prompt: 'help me with typescript generics',
    });
    expect(status).toBe(200);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(json.hookSpecificOutput.additionalContext).toContain(
      'TypeScript Generics Guide',
    );
    expect(json.hookSpecificOutput.additionalContext).toContain('[mor]');
  });

  it('deduplicates within same session_id', async () => {
    await req('POST', '/memories', {
      title: 'React Hooks Tutorial',
      content: 'useState and useEffect are the most common hooks',
    });

    const first = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-3',
      prompt: 'explain react hooks to me',
    });
    expect(first.json.hookSpecificOutput?.additionalContext).toContain(
      'React Hooks Tutorial',
    );

    const second = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-3',
      prompt: 'tell me more about react hooks',
    });
    // Same memory should not appear again
    const ctx = second.json.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).not.toContain('React Hooks Tutorial');
  });

  it('different session_ids get independent dedup', async () => {
    await req('POST', '/memories', {
      title: 'Docker Compose Setup',
      content: 'docker compose up to start all services',
    });

    const first = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-4',
      prompt: 'how to use docker compose',
    });
    expect(first.json.hookSpecificOutput?.additionalContext).toContain(
      'Docker Compose Setup',
    );

    const second = await req('POST', '/hooks/memberberry', {
      session_id: 'sess-5',
      prompt: 'how to use docker compose',
    });
    expect(second.json.hookSpecificOutput?.additionalContext).toContain(
      'Docker Compose Setup',
    );
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

  it('rejects wrong token', async () => {
    const res = await fetch(`${authUrl}/health`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects token with wrong length', async () => {
    const res = await fetch(`${authUrl}/health`, {
      headers: { Authorization: 'Bearer x' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts token via query param', async () => {
    const res = await fetch(`${authUrl}/health?token=secret123`);
    expect(res.status).toBe(200);
  });
});

describe('MCP HTTP Transport', () => {
  let mcpServer: http.Server;
  let mcpUrl: string;

  beforeEach(async () => {
    mcpServer = startServer(config, {
      port: 0,
      host: '127.0.0.1',
      mcp: true,
    });
    await new Promise<void>((resolve) => mcpServer.once('listening', resolve));
    const addr = mcpServer.address() as { port: number };
    mcpUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
  });

  it('POST /mcp returns 404 when mcp is disabled', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    expect(res.status).toBe(404);
  });

  it('initializes an MCP session', async () => {
    const res = await fetch(`${mcpUrl}/mcp`, {
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
    expect(res.status).toBe(200);
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
  });

  it('rejects POST without session ID for non-initialize requests', async () => {
    const res = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects GET with invalid session ID', async () => {
    const res = await fetch(`${mcpUrl}/mcp`, {
      method: 'GET',
      headers: { 'mcp-session-id': 'bogus-session-id' },
    });
    expect(res.status).toBe(404);
  });
});

describe('OAuth MCP Auth', () => {
  let oauthServer: http.Server;
  let oauthUrl: string;
  const PASSPHRASE = 'test-passphrase-123';

  beforeEach(async () => {
    oauthServer = startServer(config, {
      port: 0,
      host: '127.0.0.1',
      token: PASSPHRASE,
      mcp: true,
    });
    await new Promise<void>((resolve) =>
      oauthServer.once('listening', resolve),
    );
    const addr = oauthServer.address() as { port: number };
    oauthUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => oauthServer.close(() => resolve()));
  });

  // Helper: register a client
  async function registerClient() {
    const res = await fetch(`${oauthUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:3000/callback'],
        client_name: 'test-client',
        token_endpoint_auth_method: 'client_secret_post',
      }),
    });
    return res.json();
  }

  // Helper: generate PKCE pair
  function generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  // Helper: full OAuth flow → access token
  async function getAccessToken() {
    const client = await registerClient();
    const { verifier, challenge } = generatePkce();
    const state = 'test-state';

    // Authorize (POST with correct passphrase)
    const authRes = await fetch(`${oauthUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        state,
        passphrase: PASSPHRASE,
      }),
      redirect: 'manual',
    });
    const location = new URL(authRes.headers.get('location')!);
    const code = location.searchParams.get('code')!;

    // Token exchange
    const tokenRes = await fetch(`${oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: 'http://127.0.0.1:3000/callback',
      }),
    });
    const tokens = await tokenRes.json();
    return { client, tokens };
  }

  // --- Discovery ---

  it('serves OAuth AS metadata without auth', async () => {
    const res = await fetch(
      `${oauthUrl}/.well-known/oauth-authorization-server`,
    );
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.issuer).toContain('127.0.0.1');
    expect(meta.authorization_endpoint).toContain('/oauth/authorize');
    expect(meta.token_endpoint).toContain('/oauth/token');
    expect(meta.registration_endpoint).toContain('/oauth/register');
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('serves protected resource metadata without auth', async () => {
    const res = await fetch(
      `${oauthUrl}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.resource).toContain('/mcp');
    expect(meta.authorization_servers).toHaveLength(1);
    expect(meta.resource_name).toBe('mor');
  });

  // --- Client Registration ---

  it('registers a client via DCR', async () => {
    const client = await registerClient();
    expect(client.client_id).toBeDefined();
    expect(client.client_secret).toBeDefined();
    expect(client.client_id_issued_at).toBeDefined();
    expect(client.client_secret_expires_at).toBeGreaterThan(0);
  });

  it('rejects invalid client metadata', async () => {
    const res = await fetch(`${oauthUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_client_metadata');
  });

  // --- Authorization ---

  it('serves authorize form on GET', async () => {
    const client = await registerClient();
    const { challenge } = generatePkce();
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:3000/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'abc',
    });
    const res = await fetch(`${oauthUrl}/oauth/authorize?${params}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('mor');
    expect(html).toContain('passphrase');
    expect(html).toContain(client.client_id);
  });

  it('redirects with code on correct passphrase', async () => {
    const client = await registerClient();
    const { challenge } = generatePkce();
    const res = await fetch(`${oauthUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        state: 'mystate',
        passphrase: PASSPHRASE,
      }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('mystate');
    expect(location.searchParams.has('error')).toBe(false);
  });

  it('redirects with error on wrong passphrase', async () => {
    const client = await registerClient();
    const { challenge } = generatePkce();
    const res = await fetch(`${oauthUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        state: 'mystate',
        passphrase: 'wrong-passphrase',
      }),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('mystate');
  });

  // --- Token Exchange ---

  it('exchanges auth code for tokens with PKCE', async () => {
    const { tokens } = await getAccessToken();
    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.expires_in).toBe(3600);
  });

  it('rejects token exchange with wrong code_verifier', async () => {
    const client = await registerClient();
    const { challenge } = generatePkce();

    const authRes = await fetch(`${oauthUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        passphrase: PASSPHRASE,
      }),
      redirect: 'manual',
    });
    const location = new URL(authRes.headers.get('location')!);
    const code = location.searchParams.get('code')!;

    const tokenRes = await fetch(`${oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'totally-wrong-verifier',
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });
    expect(tokenRes.status).toBe(400);
    const body = await tokenRes.json();
    expect(body.error).toBe('invalid_grant');
  });

  // --- Token Refresh ---

  it('refreshes an access token', async () => {
    const { client, tokens } = await getAccessToken();

    const res = await fetch(`${oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });
    expect(res.status).toBe(200);
    const newTokens = await res.json();
    expect(newTokens.access_token).toBeDefined();
    expect(newTokens.access_token).not.toBe(tokens.access_token);
    expect(newTokens.refresh_token).toBeDefined();
  });

  // --- Token Revocation ---

  it('revokes an access token', async () => {
    const { client, tokens } = await getAccessToken();

    const revokeRes = await fetch(`${oauthUrl}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: tokens.access_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });
    expect(revokeRes.status).toBe(200);

    // Token should no longer work
    const mcpRes = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.access_token}`,
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
    expect(mcpRes.status).toBe(401);
  });

  // --- MCP Endpoint Auth ---

  it('/mcp returns 401 without token and includes resource_metadata', async () => {
    const res = await fetch(`${oauthUrl}/mcp`, {
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
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toContain('Bearer');
    expect(wwwAuth).toContain('resource_metadata');
  });

  it('/mcp accepts raw passphrase', async () => {
    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PASSPHRASE}`,
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
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('/mcp accepts passphrase via query param', async () => {
    const res = await fetch(`${oauthUrl}/mcp?token=${PASSPHRASE}`, {
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
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('/mcp accepts OAuth access token and initializes session', async () => {
    const { tokens } = await getAccessToken();

    const res = await fetch(`${oauthUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.access_token}`,
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
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  // --- REST API backward compat ---

  it('REST API still accepts direct bearer passphrase', async () => {
    const res = await fetch(`${oauthUrl}/health`, {
      headers: { Authorization: `Bearer ${PASSPHRASE}` },
    });
    expect(res.status).toBe(200);
  });

  it('REST API rejects wrong token', async () => {
    const res = await fetch(`${oauthUrl}/health`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('REST API accepts OAuth access token', async () => {
    const { tokens } = await getAccessToken();
    const res = await fetch(`${oauthUrl}/health`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(res.status).toBe(200);
  });

  it('RemoteOperations auto-refreshes expired token', async () => {
    const { client, tokens } = await getAccessToken();

    // Store credentials with the current tokens
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-autorefresh-'));
    fs.writeFileSync(
      path.join(credsDir, 'credentials.json'),
      JSON.stringify({
        [oauthUrl]: {
          client_id: client.client_id,
          client_secret: client.client_secret,
          access_token: 'expired-bogus-token',
          refresh_token: tokens.refresh_token,
        },
      }),
    );

    // Create RemoteOperations with the stored (expired) token
    const ops = new RemoteOperations(
      { ...config, server: { url: oauthUrl } },
      credsDir,
    );

    // Should auto-refresh and succeed
    const result = await ops.search('test', 5);
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();

    ops.close();
    fs.rmSync(credsDir, { recursive: true });
  });
});
