import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setServerUrl } from './config.js';

export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function credentialsPath(configDir: string): string {
  return path.join(configDir, 'credentials.json');
}

function loadCredentials(configDir: string): Record<string, OAuthCredentials> {
  try {
    return JSON.parse(fs.readFileSync(credentialsPath(configDir), 'utf-8'));
  } catch (e: any) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function saveCredentials(
  configDir: string,
  creds: Record<string, OAuthCredentials>,
): void {
  fs.writeFileSync(
    credentialsPath(configDir),
    JSON.stringify(creds, null, 2) + '\n',
    { mode: 0o600 },
  );
}

export function getStoredToken(
  configDir: string,
  serverUrl: string,
): string | undefined {
  return loadCredentials(configDir)[normalizeUrl(serverUrl)]?.access_token;
}

export function getStoredCredentials(
  configDir: string,
  serverUrl: string,
): OAuthCredentials | undefined {
  return loadCredentials(configDir)[normalizeUrl(serverUrl)];
}

export function clearStoredCredentials(
  configDir: string,
  serverUrl: string,
): void {
  const creds = loadCredentials(configDir);
  delete creds[normalizeUrl(serverUrl)];
  saveCredentials(configDir, creds);
}

/**
 * Refreshes the access token using a stored refresh token.
 * Returns the new access token, or undefined if refresh failed.
 */
export async function refreshAccessToken(
  configDir: string,
  serverUrl: string,
): Promise<string | undefined> {
  const base = normalizeUrl(serverUrl);
  const creds = loadCredentials(configDir);
  const stored = creds[base];
  if (!stored) return undefined;

  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: stored.client_id,
      client_secret: stored.client_secret,
    }),
  });

  if (!res.ok) {
    delete creds[base];
    saveCredentials(configDir, creds);
    return undefined;
  }

  const tokens = await res.json();
  creds[base] = {
    ...stored,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
  saveCredentials(configDir, creds);
  return tokens.access_token;
}

/**
 * Run the OAuth login flow: register client, open browser, catch redirect, exchange token.
 */
export async function login(
  serverUrl: string,
  configDir: string,
): Promise<void> {
  const base = normalizeUrl(serverUrl);

  // 1. Discover OAuth metadata
  const metaRes = await fetch(`${base}/.well-known/oauth-authorization-server`);
  if (!metaRes.ok) {
    throw new Error(
      `Server does not support OAuth (${metaRes.status}). Is --mcp --token enabled?`,
    );
  }
  const meta = await metaRes.json();

  // 2. Register client via DCR
  const regRes = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['http://127.0.0.1:0/callback'],
      client_name: `mor-cli-${os.hostname()}`,
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });
  if (!regRes.ok) {
    const err = await regRes.json().catch(() => ({}));
    throw new Error(
      `Client registration failed: ${err.error_description ?? regRes.statusText}`,
    );
  }
  const client = await regRes.json();

  // 3. Generate PKCE pair
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  // 4. Start temporary local server to catch the redirect
  const { code, redirectUri } = await new Promise<{
    code: string;
    redirectUri: string;
  }>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        const desc =
          url.searchParams.get('error_description') ?? 'Authorization denied';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          `<html><body><h2>Login failed</h2><p>${desc}</p><p>You can close this tab.</p></body></html>`,
        );
        srv.close();
        reject(new Error(desc));
        return;
      }

      const authCode = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!authCode || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h2>Invalid response</h2><p>You can close this tab.</p></body></html>',
        );
        srv.close();
        reject(new Error('Invalid callback parameters'));
        return;
      }

      const addr = srv.address() as { port: number };
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>Login successful!</h2><p>You can close this tab.</p></body></html>',
      );
      srv.close();
      resolve({
        code: authCode,
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
      });
    });

    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      const actualRedirectUri = `http://127.0.0.1:${addr.port}/callback`;

      // Update client registration with actual redirect URI
      // (The server validates loopback redirect URIs with port flexibility)

      const authorizeUrl = new URL(meta.authorization_endpoint);
      authorizeUrl.searchParams.set('client_id', client.client_id);
      authorizeUrl.searchParams.set('redirect_uri', actualRedirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', state);

      console.log(`Open this URL to authorize:\n`);
      console.log(`  ${authorizeUrl.toString()}\n`);
      console.log(`Waiting for authorization...`);
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        srv.close();
        reject(new Error('Login timed out (5 minutes)'));
      },
      5 * 60 * 1000,
    ).unref();
  });

  // 5. Exchange code for tokens
  const tokenRes = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${err.error_description ?? tokenRes.statusText}`,
    );
  }

  const tokens = await tokenRes.json();

  // 6. Store credentials
  const creds = loadCredentials(configDir);
  creds[base] = {
    client_id: client.client_id,
    client_secret: client.client_secret,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
  saveCredentials(configDir, creds);
  setServerUrl(base);

  console.log('Login successful! Credentials stored.');
}
