import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isLoopbackHost, timingSafeCompare } from './utils/net.js';

const CODE_TTL = 5 * 60;
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const CLIENT_SECRET_TTL = 30 * 24 * 60 * 60;
const SWEEP_INTERVAL = 10 * 60 * 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret TEXT,
    client_secret_expires_at INTEGER NOT NULL DEFAULT 0,
    registration_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    access_token TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    refresh_expires_at INTEGER NOT NULL,
    FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
  );
`;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  return hash.toString('base64url') === codeChallenge;
}

function getIssuer(hostHeader: string): string {
  const proto = isLoopbackHost(hostHeader) ? 'http' : 'https';
  return `${proto}://${hostHeader}`;
}

/**
 * RFC 8252 §7.3 — loopback redirect URIs may differ in port.
 */
function redirectUriMatches(registered: string, provided: string): boolean {
  const reg = new URL(registered);
  const prov = new URL(provided);
  if (isLoopbackHost(reg.hostname)) {
    return (
      reg.protocol === prov.protocol &&
      reg.hostname === prov.hostname &&
      reg.pathname === prov.pathname &&
      reg.search === prov.search
    );
  }
  return registered === provided;
}

function oauthError(
  error: string,
  description: string,
  status: 400 | 401 | 403 = 400,
) {
  return { body: { error, error_description: description }, status } as const;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function authorizeFormHtml(params: Record<string, string>): string {
  const hidden = Object.entries(params)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`,
    )
    .join('\n        ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mor — Authorize</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0;
      display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #16213e; border-radius: 12px; padding: 2rem; max-width: 360px; width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
    h1 { margin: 0 0 0.5rem; font-size: 1.25rem; color: #a8dadc; }
    p { margin: 0 0 1.5rem; font-size: 0.875rem; color: #888; }
    label { display: block; font-size: 0.875rem; margin-bottom: 0.5rem; }
    input[type="password"] { width: 100%; padding: 0.625rem; border: 1px solid #333;
      border-radius: 6px; background: #0f3460; color: #e0e0e0; font-size: 1rem;
      box-sizing: border-box; }
    button { margin-top: 1rem; width: 100%; padding: 0.625rem; border: none;
      border-radius: 6px; background: #e94560; color: #fff; font-size: 1rem;
      cursor: pointer; }
    button:hover { background: #c73e54; }
  </style>
</head>
<body>
  <div class="card">
    <h1>mor</h1>
    <p>An application is requesting access to your memory store.</p>
    <form method="POST" autocomplete="off">
      ${hidden}
      <label for="passphrase">Passphrase</label>
      <input type="password" id="passphrase" name="passphrase" autocomplete="off" autofocus required>
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

export function createOAuthRoutes(
  passphrase: string,
  morHome: string,
): {
  routes: Hono;
  verifyAccessToken: (token: string) => boolean;
  close: () => void;
} {
  const dbPath = path.join(morHome, 'oauth.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const stmts = {
    getClient: db.prepare(
      'SELECT client_id, client_secret, client_secret_expires_at, registration_json FROM oauth_clients WHERE client_id = ?',
    ),
    insertClient: db.prepare(
      'INSERT INTO oauth_clients (client_id, client_secret, client_secret_expires_at, registration_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    insertCode: db.prepare(
      'INSERT INTO oauth_codes (code, client_id, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    consumeCode: db.prepare(
      'DELETE FROM oauth_codes WHERE code = ? RETURNING client_id, code_challenge, redirect_uri, expires_at',
    ),
    insertToken: db.prepare(
      'INSERT INTO oauth_tokens (access_token, refresh_token, client_id, access_expires_at, refresh_expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    getAccessToken: db.prepare(
      'SELECT access_token, refresh_token, client_id, access_expires_at FROM oauth_tokens WHERE access_token = ?',
    ),
    deleteByAccessToken: db.prepare(
      'DELETE FROM oauth_tokens WHERE access_token = ?',
    ),
    deleteByRefreshToken: db.prepare(
      'DELETE FROM oauth_tokens WHERE refresh_token = ?',
    ),
    consumeRefreshToken: db.prepare(
      'DELETE FROM oauth_tokens WHERE refresh_token = ? RETURNING client_id, refresh_expires_at',
    ),
    sweepCodes: db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?'),
    sweepAccessTokens: db.prepare(
      'DELETE FROM oauth_tokens WHERE refresh_expires_at < ?',
    ),
    sweepClients: db.prepare(
      'DELETE FROM oauth_clients WHERE client_secret_expires_at > 0 AND client_secret_expires_at < ?',
    ),
  };

  const sweep = db.transaction(() => {
    const now = nowSec();
    stmts.sweepCodes.run(now);
    stmts.sweepAccessTokens.run(now);
    stmts.sweepClients.run(now);
  });
  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL);
  sweepTimer.unref();

  type ClientRow = {
    client_id: string;
    client_secret: string | null;
    client_secret_expires_at: number;
    registration_json: string;
  };

  function authenticateClient(
    clientId: string | undefined,
    clientSecret: string | undefined,
  ): ClientRow | { error: ReturnType<typeof oauthError> } {
    if (!clientId)
      return { error: oauthError('invalid_client', 'Missing client_id') };
    const row = stmts.getClient.get(clientId) as ClientRow | undefined;
    if (!row)
      return { error: oauthError('invalid_client', 'Unknown client_id') };
    if (row.client_secret) {
      if (!clientSecret)
        return {
          error: oauthError('invalid_client', 'Missing client_secret'),
        };
      if (!timingSafeCompare(clientSecret, row.client_secret))
        return {
          error: oauthError('invalid_client', 'Invalid client_secret'),
        };
      if (
        row.client_secret_expires_at > 0 &&
        row.client_secret_expires_at < nowSec()
      )
        return {
          error: oauthError('invalid_client', 'Client secret expired'),
        };
    }
    return row;
  }

  const routes = new Hono();
  routes.use(cors());

  // RFC 8414 — OAuth AS metadata
  routes.get('/.well-known/oauth-authorization-server', (c) => {
    const issuer = getIssuer(c.req.header('host') ?? 'localhost');
    c.header('Cache-Control', 'no-store');
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      revocation_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  });

  // RFC 9728 — Protected Resource Metadata
  routes.get('/.well-known/oauth-protected-resource/mcp', (c) => {
    const issuer = getIssuer(c.req.header('host') ?? 'localhost');
    c.header('Cache-Control', 'no-store');
    return c.json({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      resource_name: 'mor',
    });
  });

  // Dynamic Client Registration (RFC 7591)
  routes.post('/oauth/register', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'invalid_client_metadata', error_description: 'Invalid JSON' },
        400,
      );
    }

    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'invalid_client_metadata',
          error_description: parsed.error.message,
        },
        400,
      );
    }

    const metadata = parsed.data;
    const clientId = crypto.randomUUID();
    const isPublic = metadata.token_endpoint_auth_method === 'none';
    const clientSecret = isPublic ? null : randomToken();
    const now = nowSec();
    const secretExpiresAt = isPublic ? 0 : now + CLIENT_SECRET_TTL;

    stmts.insertClient.run(
      clientId,
      clientSecret,
      secretExpiresAt,
      JSON.stringify(metadata),
      now,
    );

    const response: Record<string, unknown> = {
      ...metadata,
      client_id: clientId,
      client_id_issued_at: now,
    };
    if (clientSecret) {
      response.client_secret = clientSecret;
      response.client_secret_expires_at = secretExpiresAt;
    }

    c.header('Cache-Control', 'no-store');
    return c.json(response, 201);
  });

  routes.get('/oauth/authorize', (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const responseType = c.req.query('response_type');
    const codeChallenge = c.req.query('code_challenge');
    const codeChallengeMethod = c.req.query('code_challenge_method');
    const state = c.req.query('state');

    // Phase 1 — pre-redirect validation (errors as JSON, not redirects)
    if (!clientId) {
      return c.json(
        { error: 'invalid_request', error_description: 'Missing client_id' },
        400,
      );
    }
    const client = stmts.getClient.get(clientId) as ClientRow | undefined;
    if (!client) {
      return c.json(
        { error: 'invalid_client', error_description: 'Unknown client_id' },
        400,
      );
    }

    const reg = JSON.parse(client.registration_json);
    const registeredUris: string[] = reg.redirect_uris ?? [];

    if (!redirectUri) {
      if (registeredUris.length !== 1) {
        return c.json(
          {
            error: 'invalid_request',
            error_description: 'redirect_uri required',
          },
          400,
        );
      }
    }
    const effectiveRedirectUri = redirectUri ?? registeredUris[0];
    const uriMatch = registeredUris.some((u: string) =>
      redirectUriMatches(u, effectiveRedirectUri),
    );
    if (!uriMatch) {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'redirect_uri mismatch',
        },
        400,
      );
    }

    // Phase 2 — post-redirect validation (errors redirect back)
    const redirectErr = (error: string, desc: string) => {
      const url = new URL(effectiveRedirectUri);
      url.searchParams.set('error', error);
      url.searchParams.set('error_description', desc);
      if (state) url.searchParams.set('state', state);
      return c.redirect(url.toString(), 302);
    };

    if (responseType !== 'code') {
      return redirectErr('unsupported_response_type', 'Must be "code"');
    }
    if (!codeChallenge) {
      return redirectErr('invalid_request', 'Missing code_challenge');
    }
    if (codeChallengeMethod !== 'S256') {
      return redirectErr(
        'invalid_request',
        'code_challenge_method must be S256',
      );
    }

    // Serve the form
    return c.html(
      authorizeFormHtml({
        client_id: clientId,
        redirect_uri: effectiveRedirectUri,
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...(state ? { state } : {}),
      }),
    );
  });

  routes.post('/oauth/authorize', async (c) => {
    const body = await c.req.parseBody();
    const clientId = body['client_id'] as string | undefined;
    const redirectUri = body['redirect_uri'] as string | undefined;
    const codeChallenge = body['code_challenge'] as string | undefined;
    const state = body['state'] as string | undefined;
    const userPassphrase = body['passphrase'] as string | undefined;

    if (!clientId || !redirectUri || !codeChallenge) {
      return c.json(
        { error: 'invalid_request', error_description: 'Missing parameters' },
        400,
      );
    }

    const client = stmts.getClient.get(clientId) as ClientRow | undefined;
    if (!client) {
      return c.json(
        { error: 'invalid_client', error_description: 'Unknown client_id' },
        400,
      );
    }
    const reg = JSON.parse(client.registration_json);
    const registeredUris: string[] = reg.redirect_uris ?? [];
    if (
      !registeredUris.some((u: string) => redirectUriMatches(u, redirectUri))
    ) {
      return c.json(
        {
          error: 'invalid_request',
          error_description: 'redirect_uri mismatch',
        },
        400,
      );
    }

    const redirectWithParams = (params: Record<string, string>) => {
      const url = new URL(redirectUri);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (state) url.searchParams.set('state', state);
      return c.redirect(url.toString(), 302);
    };

    if (!userPassphrase || !timingSafeCompare(userPassphrase, passphrase)) {
      return redirectWithParams({
        error: 'access_denied',
        error_description: 'Invalid passphrase',
      });
    }

    const code = randomToken();
    stmts.insertCode.run(
      code,
      clientId,
      codeChallenge,
      redirectUri,
      nowSec() + CODE_TTL,
    );

    return redirectWithParams({ code });
  });

  routes.post('/oauth/token', async (c) => {
    const body = await c.req.parseBody();
    const grantType = body['grant_type'] as string | undefined;
    const clientId = body['client_id'] as string | undefined;
    const clientSecret = body['client_secret'] as string | undefined;

    const clientOrErr = authenticateClient(clientId, clientSecret);
    if ('error' in clientOrErr) {
      const { body: errBody, status } = clientOrErr.error;
      return c.json(errBody, status);
    }

    c.header('Cache-Control', 'no-store');

    if (grantType === 'authorization_code') {
      const code = body['code'] as string | undefined;
      const codeVerifier = body['code_verifier'] as string | undefined;
      const bodyRedirectUri = body['redirect_uri'] as string | undefined;

      if (!code || !codeVerifier) {
        return c.json(
          {
            error: 'invalid_request',
            error_description: 'Missing code or code_verifier',
          },
          400,
        );
      }

      // Atomically consume the code to prevent replay
      const codeRow = stmts.consumeCode.get(code) as
        | {
            client_id: string;
            code_challenge: string;
            redirect_uri: string;
            expires_at: number;
          }
        | undefined;

      if (!codeRow || codeRow.client_id !== clientOrErr.client_id) {
        return c.json(
          { error: 'invalid_grant', error_description: 'Invalid code' },
          400,
        );
      }
      if (codeRow.expires_at < nowSec()) {
        return c.json(
          { error: 'invalid_grant', error_description: 'Code expired' },
          400,
        );
      }
      if (bodyRedirectUri && bodyRedirectUri !== codeRow.redirect_uri) {
        return c.json(
          {
            error: 'invalid_grant',
            error_description: 'redirect_uri mismatch',
          },
          400,
        );
      }
      if (!verifyPkce(codeVerifier, codeRow.code_challenge)) {
        return c.json(
          {
            error: 'invalid_grant',
            error_description: 'PKCE verification failed',
          },
          400,
        );
      }

      const accessToken = randomToken();
      const refreshToken = randomToken();
      const now = nowSec();
      stmts.insertToken.run(
        accessToken,
        refreshToken,
        clientOrErr.client_id,
        now + ACCESS_TTL,
        now + REFRESH_TTL,
      );

      return c.json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: ACCESS_TTL,
        refresh_token: refreshToken,
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = body['refresh_token'] as string | undefined;
      if (!refreshToken) {
        return c.json(
          {
            error: 'invalid_request',
            error_description: 'Missing refresh_token',
          },
          400,
        );
      }

      // Atomically consume the refresh token to prevent reuse
      const tokenRow = stmts.consumeRefreshToken.get(refreshToken) as
        | { client_id: string; refresh_expires_at: number }
        | undefined;

      if (!tokenRow || tokenRow.client_id !== clientOrErr.client_id) {
        return c.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid refresh_token',
          },
          400,
        );
      }
      if (tokenRow.refresh_expires_at < nowSec()) {
        return c.json(
          {
            error: 'invalid_grant',
            error_description: 'Refresh token expired',
          },
          400,
        );
      }

      const newAccessToken = randomToken();
      const newRefreshToken = randomToken();
      const now = nowSec();
      stmts.insertToken.run(
        newAccessToken,
        newRefreshToken,
        clientOrErr.client_id,
        now + ACCESS_TTL,
        now + REFRESH_TTL,
      );

      return c.json({
        access_token: newAccessToken,
        token_type: 'bearer',
        expires_in: ACCESS_TTL,
        refresh_token: newRefreshToken,
      });
    }

    return c.json(
      {
        error: 'unsupported_grant_type',
        error_description: `Unsupported grant_type: ${grantType}`,
      },
      400,
    );
  });

  routes.post('/oauth/revoke', async (c) => {
    const body = await c.req.parseBody();
    const clientId = body['client_id'] as string | undefined;
    const clientSecret = body['client_secret'] as string | undefined;
    const token = body['token'] as string | undefined;

    const clientOrErr = authenticateClient(clientId, clientSecret);
    if ('error' in clientOrErr) {
      const { body: errBody, status } = clientOrErr.error;
      return c.json(errBody, status);
    }

    c.header('Cache-Control', 'no-store');

    if (token) {
      stmts.deleteByAccessToken.run(token);
      stmts.deleteByRefreshToken.run(token);
    }

    return c.json({});
  });

  const verifyAccessToken = (token: string): boolean => {
    const row = stmts.getAccessToken.get(token) as
      | { access_token: string; access_expires_at: number }
      | undefined;
    if (!row) return false;
    if (row.access_expires_at < nowSec()) {
      stmts.deleteByAccessToken.run(token);
      return false;
    }
    return true;
  };

  const close = () => {
    clearInterval(sweepTimer);
    db.close();
  };

  return { routes, verifyAccessToken, close };
}
