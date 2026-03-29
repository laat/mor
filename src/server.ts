import http from "node:http";
import type { Config } from "./types.js";
import { LocalOperations } from "./operations.js";

function log(msg: string): void {
  process.stderr.write(`[code-memory] ${msg}\n`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

export function startServer(config: Config, opts: { port: number; host: string; token?: string }): http.Server {
  const ops = new LocalOperations(config);
  const { token } = opts;

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    try {
      // Auth check
      if (token) {
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${token}`) {
          json(res, 401, { error: "Unauthorized" });
          return;
        }
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";
      const pathname = url.pathname;

      // Route: GET /health
      if (method === "GET" && pathname === "/health") {
        json(res, 200, { ok: true });
        return;
      }

      // Route: GET /memories
      if (method === "GET" && pathname === "/memories") {
        const memories = await ops.list();
        json(res, 200, { data: memories });
        return;
      }

      // Route: GET /memories/search?q=...&limit=N
      if (method === "GET" && pathname === "/memories/search") {
        const q = url.searchParams.get("q");
        if (!q) {
          json(res, 400, { error: "Missing query parameter: q" });
          return;
        }
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const results = await ops.search(q, limit);
        json(res, 200, { data: results });
        return;
      }

      // Route: POST /memories
      if (method === "POST" && pathname === "/memories") {
        const body = JSON.parse(await readBody(req));
        if (!body.title || !body.content) {
          json(res, 400, { error: "Missing required fields: title, content" });
          return;
        }
        const mem = await ops.add(body);
        json(res, 201, { data: mem });
        return;
      }

      // Routes with :query parameter: /memories/:query
      const memoryMatch = pathname.match(/^\/memories\/(.+)$/);
      if (memoryMatch) {
        const query = decodeURIComponent(memoryMatch[1]);

        // Don't match the /search sub-path here
        if (query === "search") {
          json(res, 404, { error: "Not found" });
          return;
        }

        if (method === "GET") {
          const mem = await ops.read(query);
          if (!mem) {
            json(res, 404, { error: `Memory not found: ${query}` });
            return;
          }
          json(res, 200, { data: mem });
          return;
        }

        if (method === "PUT") {
          const body = JSON.parse(await readBody(req));
          try {
            const mem = await ops.update(query, body);
            json(res, 200, { data: mem });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            json(res, 404, { error: msg });
          }
          return;
        }

        if (method === "DELETE") {
          try {
            const result = await ops.remove(query);
            json(res, 200, { data: result });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            json(res, 404, { error: msg });
          }
          return;
        }
      }

      json(res, 404, { error: "Not found" });
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
