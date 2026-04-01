import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { serve } from '@hono/node-server';
import crypto from 'node:crypto';
import path from 'node:path';
import type http from 'node:http';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { createMcpServer } from './mcp.js';
import { createOAuthRoutes } from './oauth.js';
import { LocalOperations, NotFoundError } from './operations-local.js';
import type { Config } from './operations.js';
import { isLoopbackHost } from './utils/net.js';
import { version } from './version.js';

function log(msg: string): void {
  if (process.env.NODE_ENV === 'test') return;
  const ts = new Date().toISOString();
  process.stderr.write(`${ts} [mor] ${msg}\n`);
}

function parseLimit(raw: string | undefined, defaultLimit = 20): number {
  const n = parseInt(raw ?? String(defaultLimit), 10);
  return Number.isNaN(n) || n < 1 ? defaultLimit : n;
}

function parseOffset(raw: string | undefined): number {
  const n = parseInt(raw ?? '0', 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

function parseFilter(c: { req: { query(k: string): string | undefined } }) {
  const tag = c.req.query('tag');
  const type = c.req.query('type');
  const repo = c.req.query('repo');
  const ext = c.req.query('ext');
  return tag || type || repo || ext ? { tag, type, repo, ext } : undefined;
}

function errMsg(e: unknown): { msg: string; status: 404 | 500 } {
  const msg = e instanceof Error ? e.message : String(e);
  return { msg, status: e instanceof NotFoundError ? 404 : 500 };
}

const SESSION_NOT_FOUND = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Session not found' },
  id: null,
} as const;

export function startServer(
  config: Config,
  opts: { port: number; host: string; token?: string; mcp?: boolean },
): http.Server {
  const ops = new LocalOperations(config);
  const mcpTransports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();

  const app = new Hono();

  const oauth = opts.token
    ? createOAuthRoutes(opts.token, path.dirname(config.dbPath))
    : null;

  app.use(logger((msg) => log(msg.replace(/[?&]token=[^\s&]*/g, ''))));

  if (oauth) {
    app.route('', oauth.routes);
  }

  if (opts.token) {
    const passphraseHash = crypto
      .createHash('sha256')
      .update(opts.token)
      .digest();

    app.use(async (c, next) => {
      const p = c.req.path;
      if (p.startsWith('/.well-known/') || p.startsWith('/oauth/')) {
        return next();
      }
      const provided =
        c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ??
        c.req.query('token') ??
        '';

      const providedHash = crypto
        .createHash('sha256')
        .update(provided)
        .digest();
      if (crypto.timingSafeEqual(providedHash, passphraseHash)) {
        return next();
      }

      if (oauth && provided && oauth.verifyAccessToken(provided)) {
        return next();
      }

      if (oauth) {
        const host = c.req.header('host') ?? 'localhost';
        const proto = isLoopbackHost(host) ? 'http' : 'https';
        c.header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${proto}://${host}/.well-known/oauth-protected-resource/mcp"`,
        );
      }

      return c.json({ error: 'Unauthorized' }, 401);
    });
  }

  if (isLoopbackHost(opts.host) && !opts.token) {
    app.use(async (c, next) => {
      const reqHost = c.req.header('host');
      if (!reqHost || !isLoopbackHost(reqHost)) {
        return c.json({ error: 'Forbidden: DNS rebinding protection' }, 403);
      }
      await next();
    });
  }

  app.get('/health', (c) => c.json({ ok: true, version }));

  app.get('/memories/search', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing query parameter: q' }, 400);
    try {
      return c.json(
        await ops.search(
          q,
          parseLimit(c.req.query('limit')),
          parseFilter(c),
          parseOffset(c.req.query('offset')),
        ),
      );
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  app.get('/memories/grep', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing query parameter: q' }, 400);
    try {
      return c.json(
        await ops.grep(q, {
          limit: parseLimit(c.req.query('limit')),
          ignoreCase: c.req.query('ignoreCase') === '1',
          regex: c.req.query('regex') === '1',
          offset: parseOffset(c.req.query('offset')),
          filter: parseFilter(c),
        }),
      );
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  app.get('/memories', async (c) => {
    try {
      return c.json(
        await ops.list(
          parseFilter(c),
          parseLimit(c.req.query('limit'), 100),
          parseOffset(c.req.query('offset')),
        ),
      );
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  app.post('/memories', async (c) => {
    const body = await c.req.json();
    if (!body.title || !body.content) {
      return c.json({ error: 'Missing required fields: title, content' }, 400);
    }
    const { title, description, content, tags, type, repository } = body;
    return c.json(
      {
        data: await ops.add({
          title,
          description,
          content,
          tags,
          type,
          repository,
        }),
      },
      201,
    );
  });

  app.get('/memories/:query', async (c) => {
    const mem = await ops.read(c.req.param('query'));
    if (!mem) {
      return c.json(
        { error: `Memory not found: ${c.req.param('query')}` },
        404,
      );
    }
    return c.json({ data: mem });
  });

  app.put('/memories/:query', async (c) => {
    try {
      const { title, description, content, tags, type } = await c.req.json();
      return c.json({
        data: await ops.update(c.req.param('query'), {
          title,
          description,
          content,
          tags,
          type,
        }),
      });
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  app.delete('/memories/:query', async (c) => {
    try {
      return c.json({ data: await ops.remove(c.req.param('query')) });
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  // Memberberry hook — Claude Code HTTP hook for surfacing relevant memories
  const SESSION_TTL = 60 * 60 * 1000; // 1 hour
  const SWEEP_INTERVAL = 10 * 60 * 1000; // 10 minutes
  const memberberrySessions = new Map<
    string,
    { seen: Set<string>; lastUsed: number }
  >();
  const sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL;
    for (const [id, session] of memberberrySessions) {
      if (session.lastUsed < cutoff) memberberrySessions.delete(id);
    }
  }, SWEEP_INTERVAL);
  sweepTimer.unref();

  app.post('/hooks/memberberry', async (c) => {
    const body = await c.req.json();
    const { session_id, prompt } = body;

    if (!prompt || prompt.length < 10 || prompt.startsWith('/')) {
      return c.json({});
    }

    try {
      const results = await ops.search(prompt, 3);

      // Get or create session
      let session = memberberrySessions.get(session_id);
      if (!session) {
        session = { seen: new Set(), lastUsed: Date.now() };
        memberberrySessions.set(session_id, session);
      }
      session.lastUsed = Date.now();

      // Filter out already-surfaced memories
      const newResults = results.data.filter(
        (r) => !session!.seen.has(r.memory.id),
      );
      if (newResults.length === 0) return c.json({});

      // Record surfaced IDs
      for (const r of newResults) session.seen.add(r.memory.id);

      // Format hints
      const lines = newResults.map((r) => {
        const desc = r.memory.description ? ` — ${r.memory.description}` : '';
        return `  - ${r.memory.title} [${r.memory.id.slice(0, 8)}]${desc}`;
      });
      const context = `[mor] Potentially relevant memories (use mor MCP tools to read if needed):\n${lines.join('\n')}`;

      return c.json({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: context,
        },
      });
    } catch {
      return c.json({});
    }
  });

  app.post('/reindex', async (c) => {
    try {
      return c.json({ data: await ops.reindex() });
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  app.post('/sync', async (c) => {
    try {
      return c.json({ data: await ops.sync() });
    } catch (e) {
      const { msg, status } = errMsg(e);
      return c.json({ error: msg }, status);
    }
  });

  if (opts.mcp) {
    app.all('/mcp', async (c) => {
      const sessionId = c.req.header('mcp-session-id');

      // Look up existing transport
      const existingTransport = sessionId
        ? mcpTransports.get(sessionId)
        : undefined;

      if (c.req.method === 'GET' || c.req.method === 'DELETE') {
        if (!existingTransport) {
          return c.json(SESSION_NOT_FOUND, 404);
        }
        return existingTransport.handleRequest(c.req.raw);
      }

      // POST
      const body = await c.req.json();

      if (existingTransport) {
        return existingTransport.handleRequest(c.req.raw, {
          parsedBody: body,
        });
      }

      // No existing transport — create one for initialize requests
      if (isInitializeRequest(body)) {
        const transport: WebStandardStreamableHTTPServerTransport =
          new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (sid) => {
              mcpTransports.set(sid, transport);
            },
          });
        transport.onclose = () => {
          if (transport.sessionId) mcpTransports.delete(transport.sessionId);
        };
        const mcpServer = createMcpServer(new LocalOperations(config));
        await mcpServer.connect(transport);
        return transport.handleRequest(c.req.raw, { parsedBody: body });
      }

      return c.json(SESSION_NOT_FOUND, 404);
    });
  }

  const server = serve(
    { fetch: app.fetch, port: opts.port, hostname: opts.host },
    (info) => {
      log(`Listening on http://${opts.host}:${info.port}`);
      if (opts.mcp) log('MCP endpoint enabled at /mcp');
    },
  ) as http.Server;

  const shutdown = () => {
    log('Shutting down...');
    oauth?.close();
    clearInterval(sweepTimer);
    memberberrySessions.clear();
    for (const transport of mcpTransports.values()) {
      transport.close().catch(() => {});
    }
    mcpTransports.clear();
    ops.close();
    server.close();
  };
  const onSignal = () => {
    shutdown();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  server.on('close', () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  });

  return server;
}
