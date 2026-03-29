import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'node:crypto';
import http from 'node:http';
import { createMcpServer } from './mcp.js';
import { LocalOperations } from './operations.js';
import type { Config } from './types.js';

function log(msg: string): void {
  process.stderr.write(`[mor] ${msg}\n`);
}

async function readBody(
  req: http.IncomingMessage,
  maxBytes = 10 * 1024 * 1024,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

type Ctx = {
  url: URL;
  params: Record<string, string>;
  req: http.IncomingMessage;
  res: http.ServerResponse;
};
type Handler = (ctx: Ctx) => Promise<void>;

function router(
  routes: Array<[string, string, Handler]>,
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const compiled = routes.map(([method, pattern, handler]) => {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    return { method, re, keys, handler };
  });

  return async (req, res) => {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    );
    const method = req.method ?? 'GET';

    for (const route of compiled) {
      if (route.method !== method) continue;
      const match = url.pathname.match(route.re);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(match[i + 1]);
      });
      await route.handler({ url, params, req, res });
      return;
    }

    json(res, 404, { error: 'Not found' });
  };
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0];
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

export function startServer(
  config: Config,
  opts: { port: number; host: string; token?: string; mcp?: boolean },
): http.Server {
  const ops = new LocalOperations(config);
  const { token } = opts;
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>();

  const handle = router([
    [
      'GET',
      '/health',
      async ({ res }) => {
        json(res, 200, { ok: true });
      },
    ],

    [
      'GET',
      '/memories/search',
      async ({ url, res }) => {
        const q = url.searchParams.get('q');
        if (!q) {
          json(res, 400, { error: 'Missing query parameter: q' });
          return;
        }
        const limitRaw = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
        json(res, 200, { data: await ops.search(q, limit) });
      },
    ],

    [
      'GET',
      '/memories',
      async ({ res }) => {
        json(res, 200, { data: await ops.list() });
      },
    ],

    [
      'POST',
      '/memories',
      async ({ req, res }) => {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: 'Invalid JSON' });
          return;
        }
        if (!body.title || !body.content) {
          json(res, 400, { error: 'Missing required fields: title, content' });
          return;
        }
        const { title, description, content, tags, type, repository } = body;
        json(res, 201, {
          data: await ops.add({
            title,
            description,
            content,
            tags,
            type,
            repository,
          }),
        });
      },
    ],

    [
      'GET',
      '/memories/grep',
      async ({ url, res }) => {
        const q = url.searchParams.get('q');
        if (!q) {
          json(res, 400, { error: 'Missing query parameter: q' });
          return;
        }
        const limitRaw = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
        const ignoreCase = url.searchParams.get('ignoreCase') === '1';
        json(res, 200, { data: await ops.grep(q, limit, ignoreCase) });
      },
    ],

    [
      'GET',
      '/memories/:query',
      async ({ params, res }) => {
        const mem = await ops.read(params.query);
        if (!mem) {
          json(res, 404, { error: `Memory not found: ${params.query}` });
          return;
        }
        json(res, 200, { data: mem });
      },
    ],

    [
      'PUT',
      '/memories/:query',
      async ({ params, req, res }) => {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: 'Invalid JSON' });
          return;
        }
        try {
          const { title, description, content, tags, type } = body;
          json(res, 200, {
            data: await ops.update(params.query, {
              title,
              description,
              content,
              tags,
              type,
            }),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          json(res, msg.includes('Memory not found') ? 404 : 500, {
            error: msg,
          });
        }
      },
    ],

    [
      'POST',
      '/push',
      async ({ res }) => {
        try {
          json(res, 200, { data: await ops.push() });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          json(res, 500, { error: msg });
        }
      },
    ],

    [
      'DELETE',
      '/memories/:query',
      async ({ params, res }) => {
        try {
          json(res, 200, { data: await ops.remove(params.query) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          json(res, msg.includes('Memory not found') ? 404 : 500, {
            error: msg,
          });
        }
      },
    ],
  ]);

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    try {
      if (token) {
        const expectedBuf = Buffer.from(`Bearer ${token}`);
        const providedBuf = Buffer.from(req.headers.authorization ?? '');
        if (
          expectedBuf.byteLength !== providedBuf.byteLength ||
          !crypto.timingSafeEqual(providedBuf, expectedBuf)
        ) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
      }
      // DNS rebinding protection for loopback-bound servers
      if (isLoopbackHost(opts.host)) {
        const reqHost = req.headers.host;
        if (!reqHost || !isLoopbackHost(reqHost)) {
          json(res, 403, { error: 'Forbidden: DNS rebinding protection' });
          return;
        }
      }

      // MCP HTTP transport at /mcp
      const pathname = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? 'localhost'}`,
      ).pathname;
      if (opts.mcp && pathname === '/mcp') {
        const method = req.method ?? 'GET';
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (method === 'POST') {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error' },
                id: null,
              }),
            );
            return;
          }

          if (sessionId && mcpTransports.has(sessionId)) {
            await mcpTransports.get(sessionId)!.handleRequest(req, res, body);
          } else if (!sessionId && isInitializeRequest(body)) {
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (sid) => {
                mcpTransports.set(sid, transport);
              },
            });
            transport.onclose = () => {
              if (transport.sessionId)
                mcpTransports.delete(transport.sessionId);
            };
            const mcpServer = createMcpServer(new LocalOperations(config));
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, body);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: {
                  code: -32000,
                  message: 'Bad Request: invalid or missing session',
                },
                id: null,
              }),
            );
          }
        } else if (method === 'GET' || method === 'DELETE') {
          if (sessionId && mcpTransports.has(sessionId)) {
            await mcpTransports.get(sessionId)!.handleRequest(req, res);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: {
                  code: -32000,
                  message: 'Invalid or missing session ID',
                },
                id: null,
              }),
            );
          }
        } else {
          res.writeHead(405).end();
        }
        return;
      }

      await handle(req, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`Error: ${msg}`);
      json(res, 500, { error: msg });
    } finally {
      log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });

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

  server.listen(opts.port, opts.host, () => {
    log(`Listening on http://${opts.host}:${opts.port}`);
    if (opts.mcp) log('MCP endpoint enabled at /mcp');
  });

  return server;
}
