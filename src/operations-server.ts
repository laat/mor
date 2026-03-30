import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { serve } from '@hono/node-server';
import crypto from 'node:crypto';
import type http from 'node:http';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { createMcpServer } from './mcp.js';
import { LocalOperations } from './operations-local.js';
import type { Config } from './types.js';

function log(msg: string): void {
  process.stderr.write(`[mor] ${msg}\n`);
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0];
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

function parseLimit(raw: string | undefined): number {
  const n = parseInt(raw ?? '20', 10);
  return Number.isNaN(n) || n < 1 ? 20 : n;
}

export function startServer(
  config: Config,
  opts: { port: number; host: string; token?: string; mcp?: boolean },
): http.Server {
  const ops = new LocalOperations(config);
  const { token } = opts;
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>();

  const app = new Hono();

  // Logging
  app.use(
    logger((msg) => {
      log(msg);
    }),
  );

  // Auth
  if (token) {
    app.use(async (c, next) => {
      const expectedBuf = Buffer.from(`Bearer ${token}`);
      const providedBuf = Buffer.from(c.req.header('authorization') ?? '');
      if (
        expectedBuf.byteLength !== providedBuf.byteLength ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)
      ) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      await next();
    });
  }

  // DNS rebinding protection
  if (isLoopbackHost(opts.host)) {
    app.use(async (c, next) => {
      const reqHost = c.req.header('host');
      if (!reqHost || !isLoopbackHost(reqHost)) {
        return c.json({ error: 'Forbidden: DNS rebinding protection' }, 403);
      }
      await next();
    });
  }

  // Health
  app.get('/health', (c) => c.json({ ok: true }));

  // Search
  app.get('/memories/search', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing query parameter: q' }, 400);
    return c.json({
      data: await ops.search(q, parseLimit(c.req.query('limit'))),
    });
  });

  // Grep
  app.get('/memories/grep', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing query parameter: q' }, 400);
    const ignoreCase = c.req.query('ignoreCase') === '1';
    return c.json({
      data: await ops.grep(q, parseLimit(c.req.query('limit')), ignoreCase),
    });
  });

  // List
  app.get('/memories', async (c) => c.json({ data: await ops.list() }));

  // Create
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

  // Read
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

  // Update
  app.put('/memories/:query', async (c) => {
    const body = await c.req.json();
    try {
      const { title, description, content, tags, type } = body;
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
      const msg = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: msg },
        msg.includes('Memory not found') ? 404 : 500,
      );
    }
  });

  // Delete
  app.delete('/memories/:query', async (c) => {
    try {
      return c.json({ data: await ops.remove(c.req.param('query')) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: msg },
        msg.includes('Memory not found') ? 404 : 500,
      );
    }
  });

  // Reindex
  app.post('/reindex', async (c) => {
    try {
      return c.json({ data: await ops.reindex() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  // Sync
  app.post('/sync', async (c) => {
    try {
      return c.json({ data: await ops.sync() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  // MCP HTTP transport
  if (opts.mcp) {
    app.post('/mcp', async (c) => {
      const { incoming, outgoing } = c.env as {
        incoming: http.IncomingMessage;
        outgoing: http.ServerResponse;
      };
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          },
          400,
        );
      }

      const sessionId = c.req.header('mcp-session-id');
      if (sessionId && mcpTransports.has(sessionId)) {
        await mcpTransports
          .get(sessionId)!
          .handleRequest(incoming, outgoing, body);
      } else if (!sessionId && isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
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
        await transport.handleRequest(incoming, outgoing, body);
      } else {
        return c.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: invalid or missing session',
            },
            id: null,
          },
          400,
        );
      }
      // Transport already wrote the response
      return undefined as any;
    });

    app.get('/mcp', async (c) => {
      const { incoming, outgoing } = c.env as {
        incoming: http.IncomingMessage;
        outgoing: http.ServerResponse;
      };
      const sessionId = c.req.header('mcp-session-id');
      if (!sessionId || !mcpTransports.has(sessionId)) {
        return c.json(
          {
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Invalid or missing session ID' },
            id: null,
          },
          400,
        );
      }
      await mcpTransports.get(sessionId)!.handleRequest(incoming, outgoing);
      return undefined as any;
    });

    app.delete('/mcp', async (c) => {
      const { incoming, outgoing } = c.env as {
        incoming: http.IncomingMessage;
        outgoing: http.ServerResponse;
      };
      const sessionId = c.req.header('mcp-session-id');
      if (!sessionId || !mcpTransports.has(sessionId)) {
        return c.json(
          {
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Invalid or missing session ID' },
            id: null,
          },
          400,
        );
      }
      await mcpTransports.get(sessionId)!.handleRequest(incoming, outgoing);
      return undefined as any;
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
    for (const transport of mcpTransports.values()) {
      transport.close().catch(() => {});
    }
    mcpTransports.clear();
    ops.close();
    server.close();
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  server.on('close', () => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  return server;
}
