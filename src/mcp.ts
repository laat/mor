import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { z } from 'zod';
import { isRemote, loadConfig } from './config.js';
import { LocalOperations, type Operations } from './operations.js';
import { RemoteOperations } from './remote.js';

function createOps(): Operations {
  const config = loadConfig();
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'mor',
    version: '0.1.0',
  });

  const ops = createOps();

  server.registerTool(
    'memory_search',
    {
      description:
        'Search memories by query string. Returns matching memories with scores.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 20)'),
      },
    },
    async ({ query, limit }) => {
      const results = await ops.search(query, limit ?? 20);
      const text = results
        .map((r) => {
          const tags =
            r.memory.tags.length > 0
              ? `\nTags: ${r.memory.tags.join(', ')}`
              : '';
          return `## ${r.memory.title}\nID: ${r.memory.id}\nFile: ${path.basename(r.memory.filePath)}${tags}\nScore: ${r.score.toFixed(3)}\n\n${r.memory.content}`;
        })
        .join('\n\n---\n\n');
      return {
        content: [
          { type: 'text' as const, text: text || 'No memories found.' },
        ],
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
      const tags = mem.tags.length > 0 ? `\nTags: ${mem.tags.join(', ')}` : '';
      const text = `## ${mem.title}\nID: ${mem.id}\nFile: ${path.basename(mem.filePath)}${tags}\nType: ${mem.type}\nCreated: ${mem.created}\nUpdated: ${mem.updated}\n\n${mem.content}`;
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
        content: z.string().describe('Memory content (markdown)'),
        tags: z.array(z.string()).optional().describe('Tags'),
        type: z
          .enum([
            'user',
            'feedback',
            'project',
            'reference',
            'knowledge',
            'snippet',
            'file',
          ])
          .optional()
          .describe('Memory type (default: knowledge)'),
      },
    },
    async ({ title, content, tags, type }) => {
      const mem = await ops.add({ title, content, tags, type });
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
    },
    async () => {
      const memories = await ops.list();
      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories stored.' }],
        };
      }
      const lines = memories.map((mem) => {
        const tags = mem.tags.length > 0 ? ` [${mem.tags.join(', ')}]` : '';
        return `- ${mem.id.slice(0, 8)}  ${mem.title}${tags}`;
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
        content: z.string().optional().describe('New content'),
        tags: z.array(z.string()).optional().describe('New tags'),
        type: z
          .enum([
            'user',
            'feedback',
            'project',
            'reference',
            'knowledge',
            'snippet',
            'file',
          ])
          .optional()
          .describe('New type'),
      },
    },
    async ({ query, title, content, tags, type }) => {
      try {
        const updated = await ops.update(query, { title, content, tags, type });
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
