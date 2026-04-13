import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  getStoredToken,
  getStoredCredentials,
  clearStoredCredentials,
  refreshAccessToken,
} from './oauth-login.js';
import { loadConfig } from './config.js';
import { startServer } from './operations-server.js';
import type { Config } from './operations.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-oauth-login-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('credential storage', () => {
  it('returns undefined when no credentials stored', () => {
    expect(getStoredToken(tmpDir, 'http://example.com')).toBeUndefined();
    expect(getStoredCredentials(tmpDir, 'http://example.com')).toBeUndefined();
  });

  it('stores and retrieves credentials', () => {
    const creds = {
      'http://example.com': {
        client_id: 'cid',
        client_secret: 'csec',
        access_token: 'at',
        refresh_token: 'rt',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'credentials.json'),
      JSON.stringify(creds),
    );

    expect(getStoredToken(tmpDir, 'http://example.com')).toBe('at');
    expect(getStoredCredentials(tmpDir, 'http://example.com')).toEqual(
      creds['http://example.com'],
    );
  });

  it('strips trailing slashes from server URL', () => {
    const creds = {
      'http://example.com': {
        client_id: 'cid',
        client_secret: 'csec',
        access_token: 'at',
        refresh_token: 'rt',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'credentials.json'),
      JSON.stringify(creds),
    );

    expect(getStoredToken(tmpDir, 'http://example.com/')).toBe('at');
    expect(getStoredToken(tmpDir, 'http://example.com///')).toBe('at');
  });

  it('clears credentials', () => {
    const creds = {
      'http://a.com': {
        client_id: 'a',
        client_secret: 'a',
        access_token: 'a',
        refresh_token: 'a',
      },
      'http://b.com': {
        client_id: 'b',
        client_secret: 'b',
        access_token: 'b',
        refresh_token: 'b',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'credentials.json'),
      JSON.stringify(creds),
    );

    clearStoredCredentials(tmpDir, 'http://a.com');

    expect(getStoredToken(tmpDir, 'http://a.com')).toBeUndefined();
    expect(getStoredToken(tmpDir, 'http://b.com')).toBe('b');
  });

  it('credentials file has restrictive permissions', () => {
    clearStoredCredentials(tmpDir, 'http://example.com');
    const stat = fs.statSync(path.join(tmpDir, 'credentials.json'));
    // 0o600 = owner read/write only
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('creates parent directory when saving credentials', () => {
    const nested = path.join(tmpDir, 'nested', 'state');
    clearStoredCredentials(nested, 'http://example.com');
    expect(fs.existsSync(path.join(nested, 'credentials.json'))).toBe(true);
  });
});

describe('refreshAccessToken', () => {
  let testDir: string;
  let config: Config;
  let server: http.Server;
  let baseUrl: string;
  const PASSPHRASE = 'refresh-test-pass';

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-refresh-test-'));
    process.env.MOR_HOME = testDir;
    config = loadConfig();
    server = startServer(config, {
      port: 0,
      host: '127.0.0.1',
      token: PASSPHRASE,
      mcp: true,
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(testDir, { recursive: true });
    delete process.env.MOR_HOME;
  });

  it('returns undefined when no credentials stored', async () => {
    const result = await refreshAccessToken(tmpDir, baseUrl);
    expect(result).toBeUndefined();
  });

  it('refreshes token and updates stored credentials', async () => {
    // Register a client and get tokens via the OAuth flow
    const regRes = await fetch(`${baseUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:9999/callback'],
        client_name: 'refresh-test',
        token_endpoint_auth_method: 'client_secret_post',
      }),
    });
    const client = await regRes.json();

    // Get tokens via auth code flow
    const crypto = await import('node:crypto');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    const authRes = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:9999/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_type: 'code',
        passphrase: PASSPHRASE,
      }),
      redirect: 'manual',
    });
    const location = new URL(authRes.headers.get('location')!);
    const code = location.searchParams.get('code')!;

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: 'http://127.0.0.1:9999/callback',
      }),
    });
    const tokens = await tokenRes.json();

    // Store credentials
    fs.writeFileSync(
      path.join(tmpDir, 'credentials.json'),
      JSON.stringify({
        [baseUrl]: {
          client_id: client.client_id,
          client_secret: client.client_secret,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        },
      }),
    );

    // Refresh
    const newToken = await refreshAccessToken(tmpDir, baseUrl);
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(tokens.access_token);

    // Stored credentials should be updated
    const stored = getStoredCredentials(tmpDir, baseUrl);
    expect(stored!.access_token).toBe(newToken);
    expect(stored!.refresh_token).not.toBe(tokens.refresh_token);
  });

  it('clears credentials on failed refresh', async () => {
    // Store bogus credentials
    fs.writeFileSync(
      path.join(tmpDir, 'credentials.json'),
      JSON.stringify({
        [baseUrl]: {
          client_id: 'bogus',
          client_secret: 'bogus',
          access_token: 'bogus',
          refresh_token: 'bogus',
        },
      }),
    );

    const result = await refreshAccessToken(tmpDir, baseUrl);
    expect(result).toBeUndefined();
    expect(getStoredCredentials(tmpDir, baseUrl)).toBeUndefined();
  });
});
