import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { z } from 'zod';
import { isRemote, loadConfig } from './config.js';
import { filterMemories, filterResults } from './filter.js';
import { LocalOperations, type Operations } from './operations.js';
import { RemoteOperations } from './remote.js';
import { MEMORY_TYPES } from './types.js';

function createOps(): Operations {
  const config = loadConfig();
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

export function createMcpServer(ops: Operations): McpServer {
  const server = new McpServer({
    name: 'mor',
    version: '0.1.0',
    description:
      "The user's primary memory store. Contains saved code snippets, files, preferences, and reference notes. Check here first when the user asks to recall, find, or reuse something they previously saved.",
  });

  server.registerTool(
    'memory_search',
    {
      description:
        'Search memories by query. Returns the top result with full content, and summaries for the rest. Use memory_read to get full content of other results.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 20)'),
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
      },
    },
    async ({ query, limit, tag }) => {
      let results = await ops.search(query, limit ?? 20);
      if (tag) results = filterResults(results, { tag });
      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories found.' }],
        };
      }
      const lines = results.map((r, i) => {
        const tags =
          r.memory.tags.length > 0 ? `  [${r.memory.tags.join(', ')}]` : '';
        const desc = r.memory.description ? `\n  ${r.memory.description}` : '';
        const score = `  (${r.score.toFixed(2)})`;
        const preview =
          i > 0 && !r.memory.description
            ? `\n  ${r.memory.content.split('\n')[0].slice(0, 100)}`
            : '';
        const body = i === 0 ? `\n\n${r.memory.content}` : '';
        return `- ${r.memory.id.slice(0, 8)}  ${r.memory.title}${tags}${score}${desc}${preview}${body}`;
      });
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  server.registerTool(
    'memory_read',
    {
      description:
        'Read a specific memory by UUID, UUID prefix, filename, or search query.',
      inputSchema: {
        query: z
          .string()
          .describe('UUID, UUID prefix, filename, or search query'),
      },
    },
    async ({ query }) => {
      const mem = await ops.read(query);
      if (!mem) {
        return {
          content: [
            { type: 'text' as const, text: `Memory not found: ${query}` },
          ],
          isError: true,
        };
      }
      const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
      const text = `## ${mem.title}${tags}\n\n${mem.content}`;
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.registerTool(
    'memory_add',
    {
      description:
        'Create a new memory with title, content, optional tags and type.',
      inputSchema: {
        title: z.string().describe('Memory title'),
        description: z.string().optional().describe('Short description'),
        content: z.string().describe('Memory content (markdown)'),
        tags: z.array(z.string()).optional().describe('Tags'),
        type: z
          .enum(MEMORY_TYPES)
          .optional()
          .describe('Memory type (default: knowledge)'),
      },
    },
    async ({ title, description, content, tags, type }) => {
      const mem = await ops.add({ title, description, content, tags, type });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created memory: ${mem.title}\nID: ${mem.id}\nFile: ${path.basename(mem.filePath)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'memory_remove',
    {
      description:
        'Delete a memory by UUID, UUID prefix, filename, or search query.',
      inputSchema: {
        query: z
          .string()
          .describe('UUID, UUID prefix, filename, or search query'),
      },
    },
    async ({ query }) => {
      try {
        const result = await ops.remove(query);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Removed: ${result.title} (${result.id})`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: e instanceof Error ? e.message : String(e),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'memory_list',
    {
      description: 'List all stored memories with their titles, IDs, and tags.',
      inputSchema: {
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
      },
    },
    async ({ tag }) => {
      let memories = await ops.list();
      if (tag) memories = filterMemories(memories, { tag });
      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories stored.' }],
        };
      }
      const lines = memories.map((mem) => {
        const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
        const desc = mem.description ? `\n  ${mem.description}` : '';
        return `- ${mem.id.slice(0, 8)}  ${mem.title}${tags}${desc}`;
      });
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'memory_update',
    {
      description: "Update an existing memory's title, content, tags, or type.",
      inputSchema: {
        query: z
          .string()
          .describe(
            'UUID, UUID prefix, filename, or search query to find the memory',
          ),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        content: z.string().optional().describe('New content'),
        tags: z.array(z.string()).optional().describe('New tags'),
        type: z.enum(MEMORY_TYPES).optional().describe('New type'),
      },
    },
    async ({ query, title, description, content, tags, type }) => {
      try {
        const updated = await ops.update(query, {
          title,
          description,
          content,
          tags,
          type,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated: ${updated.title}\nID: ${updated.id}\nFile: ${path.basename(updated.filePath)}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: e instanceof Error ? e.message : String(e),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const ops = createOps();
  const server = createMcpServer(ops);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
