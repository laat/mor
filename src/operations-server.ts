import { serve } from '@hono/node-server';
import crypto from 'node:crypto';
import type http from 'node:http';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
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
  opts: { port: number; host: string; token?: string },
): http.Server {
  const ops = new LocalOperations(config);

  const app = new Hono();

  app.use(logger((msg) => log(msg)));

  if (opts.token) {
    app.use(async (c, next) => {
      const expectedBuf = Buffer.from(`Bearer ${opts.token}`);
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

  if (isLoopbackHost(opts.host)) {
    app.use(async (c, next) => {
      const reqHost = c.req.header('host');
      if (!reqHost || !isLoopbackHost(reqHost)) {
        return c.json({ error: 'Forbidden: DNS rebinding protection' }, 403);
      }
      await next();
    });
  }

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/memories/search', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing query parameter: q' }, 400);
    return c.json({
      data: await ops.search(q, parseLimit(c.req.query('limit'))),
    });
  });

  app.get('/memories/grep', async (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Missing query parameter: q' }, 400);
    const ignoreCase = c.req.query('ignoreCase') === '1';
    return c.json({
      data: await ops.grep(q, parseLimit(c.req.query('limit')), ignoreCase),
    });
  });

  app.get('/memories', async (c) => c.json({ data: await ops.list() }));

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

  app.post('/reindex', async (c) => {
    try {
      return c.json({ data: await ops.reindex() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  app.post('/sync', async (c) => {
    try {
      return c.json({ data: await ops.sync() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  const server = serve(
    { fetch: app.fetch, port: opts.port, hostname: opts.host },
    (info) => {
      log(`Listening on http://${opts.host}:${info.port}`);
    },
  ) as http.Server;

  const shutdown = () => {
    log('Shutting down...');
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
