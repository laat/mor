import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { syncIndex, searchAsync } from "./index.js";
import { createMemory, readMemory, deleteMemory, updateMemory, listMemoryFiles } from "./memory.js";
import { resolveQuery } from "./query.js";
import path from "node:path";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "code-memory",
    version: "0.1.0",
  });

  server.tool(
    "memory_search",
    "Search memories by query string. Returns matching memories with scores.",
    { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 20)") },
    async ({ query, limit }) => {
      const config = loadConfig();
      const db = openDb(config);
      try {
        const results = await searchAsync(config, db, query, limit ?? 20);
        const text = results
          .map((r) => {
            const tags = r.memory.tags.length > 0 ? `\nTags: ${r.memory.tags.join(", ")}` : "";
            return `## ${r.memory.title}\nID: ${r.memory.id}\nFile: ${path.basename(r.memory.filePath)}${tags}\nScore: ${r.score.toFixed(3)}\n\n${r.memory.content}`;
          })
          .join("\n\n---\n\n");
        return { content: [{ type: "text" as const, text: text || "No memories found." }] };
      } finally {
        db.close();
      }
    },
  );

  server.tool(
    "memory_read",
    "Read a specific memory by UUID, UUID prefix, filename, or search query.",
    { query: z.string().describe("UUID, UUID prefix, filename, or search query") },
    async ({ query }) => {
      const config = loadConfig();
      const db = openDb(config);
      try {
        const mem = resolveQuery(config, db, query);
        if (!mem) {
          return { content: [{ type: "text" as const, text: `Memory not found: ${query}` }], isError: true };
        }
        const tags = mem.tags.length > 0 ? `\nTags: ${mem.tags.join(", ")}` : "";
        const text = `## ${mem.title}\nID: ${mem.id}\nFile: ${path.basename(mem.filePath)}${tags}\nType: ${mem.type}\nCreated: ${mem.created}\nUpdated: ${mem.updated}\n\n${mem.content}`;
        return { content: [{ type: "text" as const, text }] };
      } finally {
        db.close();
      }
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
      const config = loadConfig();
      const db = openDb(config);
      try {
        const mem = createMemory(config, { title, content, tags, type });
        syncIndex(config, db);
        return {
          content: [
            {
              type: "text" as const,
              text: `Created memory: ${mem.title}\nID: ${mem.id}\nFile: ${path.basename(mem.filePath)}`,
            },
          ],
        };
      } finally {
        db.close();
      }
    },
  );

  server.tool(
    "memory_remove",
    "Delete a memory by UUID, UUID prefix, filename, or search query.",
    { query: z.string().describe("UUID, UUID prefix, filename, or search query") },
    async ({ query }) => {
      const config = loadConfig();
      const db = openDb(config);
      try {
        const mem = resolveQuery(config, db, query);
        if (!mem) {
          return { content: [{ type: "text" as const, text: `Memory not found: ${query}` }], isError: true };
        }
        deleteMemory(mem.filePath);
        syncIndex(config, db);
        return { content: [{ type: "text" as const, text: `Removed: ${mem.title} (${mem.id})` }] };
      } finally {
        db.close();
      }
    },
  );

  server.tool(
    "memory_list",
    "List all stored memories with their titles, IDs, and tags.",
    {},
    async () => {
      const config = loadConfig();
      const db = openDb(config);
      try {
        syncIndex(config, db);
        const files = listMemoryFiles(config);
        if (files.length === 0) {
          return { content: [{ type: "text" as const, text: "No memories stored." }] };
        }
        const lines: string[] = [];
        for (const filePath of files) {
          try {
            const mem = readMemory(filePath);
            const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
            lines.push(`- ${mem.id.slice(0, 8)}  ${mem.title}${tags}`);
          } catch {
            lines.push(`- (error reading ${path.basename(filePath)})`);
          }
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } finally {
        db.close();
      }
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
      const config = loadConfig();
      const db = openDb(config);
      try {
        const mem = resolveQuery(config, db, query);
        if (!mem) {
          return { content: [{ type: "text" as const, text: `Memory not found: ${query}` }], isError: true };
        }
        const updated = updateMemory(mem.filePath, { title, content, tags, type });
        syncIndex(config, db);
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated: ${updated.title}\nID: ${updated.id}\nFile: ${path.basename(updated.filePath)}`,
            },
          ],
        };
      } finally {
        db.close();
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
