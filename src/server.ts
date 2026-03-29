import crypto from "node:crypto";
import http from "node:http";
import type { Config } from "./types.js";
import { LocalOperations } from "./operations.js";

function log(msg: string): void {
  process.stderr.write(`[code-memory] ${msg}\n`);
}

async function readBody(req: http.IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

type Ctx = { url: URL; params: Record<string, string>; req: http.IncomingMessage; res: http.ServerResponse };
type Handler = (ctx: Ctx) => Promise<void>;

function router(routes: Array<[string, string, Handler]>): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const compiled = routes.map(([method, pattern, handler]) => {
    const keys: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    return { method, re, keys, handler };
  });

  return async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    for (const route of compiled) {
      if (route.method !== method) continue;
      const match = url.pathname.match(route.re);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(match[i + 1]); });
      await route.handler({ url, params, req, res });
      return;
    }

    json(res, 404, { error: "Not found" });
  };
}

export function startServer(config: Config, opts: { port: number; host: string; token?: string }): http.Server {
  const ops = new LocalOperations(config);
  const { token } = opts;

  const handle = router([
    ["GET", "/health", async ({ res }) => {
      json(res, 200, { ok: true });
    }],

    ["GET", "/memories/search", async ({ url, res }) => {
      const q = url.searchParams.get("q");
      if (!q) { json(res, 400, { error: "Missing query parameter: q" }); return; }
      const limitRaw = parseInt(url.searchParams.get("limit") ?? "20", 10);
      const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
      json(res, 200, { data: await ops.search(q, limit) });
    }],

    ["GET", "/memories", async ({ res }) => {
      json(res, 200, { data: await ops.list() });
    }],

    ["POST", "/memories", async ({ req, res }) => {
      let body: any;
      try { body = JSON.parse(await readBody(req)); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      if (!body.title || !body.content) { json(res, 400, { error: "Missing required fields: title, content" }); return; }
      const { title, content, tags, type, repository } = body;
      json(res, 201, { data: await ops.add({ title, content, tags, type, repository }) });
    }],

    ["GET", "/memories/:query", async ({ params, res }) => {
      const mem = await ops.read(params.query);
      if (!mem) { json(res, 404, { error: `Memory not found: ${params.query}` }); return; }
      json(res, 200, { data: mem });
    }],

    ["PUT", "/memories/:query", async ({ params, req, res }) => {
      let body: any;
      try { body = JSON.parse(await readBody(req)); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      try {
        const { title, content, tags, type } = body;
        json(res, 200, { data: await ops.update(params.query, { title, content, tags, type }) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        json(res, msg.includes("Memory not found") ? 404 : 500, { error: msg });
      }
    }],

    ["DELETE", "/memories/:query", async ({ params, res }) => {
      try {
        json(res, 200, { data: await ops.remove(params.query) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        json(res, msg.includes("Memory not found") ? 404 : 500, { error: msg });
      }
    }],
  ]);

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    try {
      if (token) {
        const expectedBuf = Buffer.from(`Bearer ${token}`);
        const providedBuf = Buffer.from(req.headers.authorization ?? "");
        if (expectedBuf.byteLength !== providedBuf.byteLength || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
          json(res, 401, { error: "Unauthorized" });
          return;
        }
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
    log("Shutting down...");
    ops.close();
    server.close();
  };
  process.on("SIGINT", () => { shutdown(); process.exit(0); });
  process.on("SIGTERM", () => { shutdown(); process.exit(0); });

  server.on("close", () => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  server.listen(opts.port, opts.host, () => {
    log(`Listening on http://${opts.host}:${opts.port}`);
  });

  return server;
}
