import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, isRemote } from "./config.js";
import { LocalOperations, type Operations } from "./operations.js";
import { RemoteOperations } from "./remote.js";
import path from "node:path";

function createOps(): Operations {
  const config = loadConfig();
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "code-memory",
    version: "0.1.0",
  });

  const ops = createOps();

  server.tool(
    "memory_search",
    "Search memories by query string. Returns matching memories with scores.",
    { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 20)") },
    async ({ query, limit }) => {
      const results = await ops.search(query, limit ?? 20);
      const text = results
        .map((r) => {
          const tags = r.memory.tags.length > 0 ? `\nTags: ${r.memory.tags.join(", ")}` : "";
          return `## ${r.memory.title}\nID: ${r.memory.id}\nFile: ${path.basename(r.memory.filePath)}${tags}\nScore: ${r.score.toFixed(3)}\n\n${r.memory.content}`;
        })
        .join("\n\n---\n\n");
      return { content: [{ type: "text" as const, text: text || "No memories found." }] };
    },
  );

  server.tool(
    "memory_read",
    "Read a specific memory by UUID, UUID prefix, filename, or search query.",
    { query: z.string().describe("UUID, UUID prefix, filename, or search query") },
    async ({ query }) => {
      const mem = await ops.read(query);
      if (!mem) {
        return { content: [{ type: "text" as const, text: `Memory not found: ${query}` }], isError: true };
      }
      const tags = mem.tags.length > 0 ? `\nTags: ${mem.tags.join(", ")}` : "";
      const text = `## ${mem.title}\nID: ${mem.id}\nFile: ${path.basename(mem.filePath)}${tags}\nType: ${mem.type}\nCreated: ${mem.created}\nUpdated: ${mem.updated}\n\n${mem.content}`;
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "memory_add",
    "Create a new memory with title, content, optional tags and type.",
    {
      title: z.string().describe("Memory title"),
      content: z.string().describe("Memory content (markdown)"),
      tags: z.array(z.string()).optional().describe("Tags"),
      type: z.string().optional().describe("Memory type (default: knowledge)"),
    },
    async ({ title, content, tags, type }) => {
      const mem = await ops.add({ title, content, tags, type });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created memory: ${mem.title}\nID: ${mem.id}\nFile: ${path.basename(mem.filePath)}`,
          },
        ],
      };
    },
  );

  server.tool(
    "memory_remove",
    "Delete a memory by UUID, UUID prefix, filename, or search query.",
    { query: z.string().describe("UUID, UUID prefix, filename, or search query") },
    async ({ query }) => {
      try {
        const result = await ops.remove(query);
        return { content: [{ type: "text" as const, text: `Removed: ${result.title} (${result.id})` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    },
  );

  server.tool(
    "memory_list",
    "List all stored memories with their titles, IDs, and tags.",
    {},
    async () => {
      const memories = await ops.list();
      if (memories.length === 0) {
        return { content: [{ type: "text" as const, text: "No memories stored." }] };
      }
      const lines = memories.map((mem) => {
        const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
        return `- ${mem.id.slice(0, 8)}  ${mem.title}${tags}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "memory_update",
    "Update an existing memory's title, content, tags, or type.",
    {
      query: z.string().describe("UUID, UUID prefix, filename, or search query to find the memory"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New content"),
      tags: z.array(z.string()).optional().describe("New tags"),
      type: z.string().optional().describe("New type"),
    },
    async ({ query, title, content, tags, type }) => {
      try {
        const updated = await ops.update(query, { title, content, tags, type });
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated: ${updated.title}\nID: ${updated.id}\nFile: ${path.basename(updated.filePath)}`,
            },
          ],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
