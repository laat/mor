import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { isRemote, loadConfig } from './config.js';
import { LocalOperations } from './operations-local.js';
import { RemoteOperations } from './operations-client.js';
import { MEMORY_TYPES, type Operations } from './operations.js';
import { unifiedDiff } from './utils/diff.js';

function createOps(): Operations {
  const config = loadConfig();
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export function createMcpServer(ops: Operations): McpServer {
  const server = new McpServer({
    name: 'mor',
    version,
    description:
      "The user's primary memory store. Contains saved code snippets, files, preferences, and reference notes. Check here first when the user asks to recall, find, or reuse something they previously saved.",
  });

  server.registerTool(
    'memory_search',
    {
      description:
        'Search memories by query. Returns top result with full content, and summaries for the rest.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 20)'),
        offset: z
          .number()
          .optional()
          .describe('Skip first N results (default 0)'),
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
        type: z.string().optional().describe('Filter by memory type'),
      },
    },
    async ({ query, limit, offset, tag, type }) => {
      const page = await ops.search(
        query,
        limit ?? 20,
        { tag, type },
        offset ?? 0,
      );
      if (page.data.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories found.' }],
        };
      }
      const header = `Showing ${page.offset + 1}–${page.offset + page.data.length} of ${page.total} results\n\n`;
      const lines = page.data.map((r) => {
        const tags =
          r.memory.tags.length > 0 ? `  [${r.memory.tags.join(', ')}]` : '';
        const desc = r.memory.description ? `\n  ${r.memory.description}` : '';
        const score = `  (${r.score.toFixed(2)})`;
        return `- ${r.memory.id}  ${r.memory.title}${tags}${score}${desc}`;
      });
      const top = page.data[0];
      const topContent = `\n\n---\n\nTop result: ${top.memory.id}  ${top.memory.title}\n\n${top.memory.content}`;
      return {
        content: [
          {
            type: 'text' as const,
            text: header + lines.join('\n') + topContent,
          },
        ],
      };
    },
  );

  server.registerTool(
    'memory_grep',
    {
      description:
        'Search memory content by substring or regex. Use for exact strings, code identifiers, URLs, or patterns.',
      inputSchema: {
        pattern: z.string().describe('Substring or regex pattern'),
        limit: z.number().optional().describe('Max results (default 20)'),
        offset: z
          .number()
          .optional()
          .describe('Skip first N results (default 0)'),
        ignore_case: z
          .boolean()
          .optional()
          .describe('Case-insensitive (default false)'),
        regex: z
          .boolean()
          .optional()
          .describe('Treat pattern as regex (default false)'),
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
        type: z.string().optional().describe('Filter by memory type'),
      },
    },
    async ({ pattern, limit, offset, ignore_case, regex, tag, type }) => {
      const page = await ops.grep(pattern, {
        limit: limit ?? 20,
        ignoreCase: ignore_case,
        filter: { tag, type },
        offset: offset ?? 0,
        regex,
      });
      if (page.data.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories found.' }],
        };
      }
      const header = `Showing ${page.offset + 1}–${page.offset + page.data.length} of ${page.total} results\n\n`;
      const lines = page.data.map((mem) => {
        const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
        const desc = mem.description ? `\n  ${mem.description}` : '';
        return `- ${mem.id}  ${mem.title}${tags}${desc}`;
      });
      const top = page.data[0];
      const topContent = `\n\n---\n\nTop result: ${top.id}  ${top.title}\n\n${top.content}`;
      return {
        content: [
          {
            type: 'text' as const,
            text: header + lines.join('\n') + topContent,
          },
        ],
      };
    },
  );

  server.registerTool(
    'memory_read',
    {
      description:
        'Read full content of one or more memories by ID.',
      inputSchema: {
        ids: z
          .array(z.string())
          .describe('UUIDs of the memories to read'),
      },
    },
    async ({ ids }) => {
      if (ids.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No id or ids provided.' }],
          isError: true,
        };
      }
      const sections: string[] = [];
      const notFound: string[] = [];
      for (const memId of ids) {
        const mem = await ops.read(memId);
        if (!mem) {
          notFound.push(memId);
          continue;
        }
        const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
        sections.push(`## ${mem.title}${tags}\n\n${mem.content}`);
      }
      if (sections.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory not found: ${notFound.join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      const text =
        sections.join('\n\n---\n\n') +
        (notFound.length > 0
          ? `\n\n---\n\nNot found: ${notFound.join(', ')}`
          : '');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.registerTool(
    'memory_create',
    {
      description:
        'Create a new memory with title, content, optional tags and type.',
      inputSchema: {
        title: z.string().describe('Memory title'),
        description: z.string().optional().describe('Short description'),
        content: z.string().describe('Memory content (markdown)'),
        tags: z.array(z.string()).nullish().describe('Tags'),
        type: z
          .enum(MEMORY_TYPES)
          .nullish()
          .describe('Memory type (default: knowledge)'),
      },
    },
    async ({ title, description, content, tags, type }) => {
      try {
        const mem = await ops.add({
          title,
          description,
          content,
          tags: tags ?? undefined,
          type: type ?? undefined,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Created: ${mem.title} (${mem.id})`,
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
    'memory_remove',
    {
      description:
        'Delete a memory by ID. Use memory_search to find the ID first.',
      inputSchema: {
        id: z.string().describe('Full UUID of the memory'),
      },
    },
    async ({ id }) => {
      try {
        const result = await ops.remove(id);
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
      description:
        'List all memories with titles, IDs, and tags. Use tag/type params to filter.',
      inputSchema: {
        limit: z.number().optional().describe('Max results (default 100)'),
        offset: z
          .number()
          .optional()
          .describe('Skip first N results (default 0)'),
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
        type: z.string().optional().describe('Filter by memory type'),
      },
    },
    async ({ limit, offset, tag, type }) => {
      const page = await ops.list({ tag, type }, limit ?? 100, offset ?? 0);
      if (page.data.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories stored.' }],
        };
      }
      const header = `Showing ${page.offset + 1}–${page.offset + page.data.length} of ${page.total} results\n\n`;
      const lines = page.data.map((mem) => {
        const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
        const desc = mem.description ? `\n  ${mem.description}` : '';
        return `- ${mem.id}  ${mem.title}${tags}${desc}`;
      });
      return {
        content: [{ type: 'text' as const, text: header + lines.join('\n') }],
      };
    },
  );

  server.registerTool(
    'memory_update',
    {
      description:
        'Update a memory by ID. Use memory_search to find the ID first, then pass it here. Only the provided fields are changed.',
      inputSchema: {
        id: z.string().describe('Full UUID of the memory'),
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        content: z.string().optional().describe('New content'),
        tags: z.array(z.string()).optional().describe('New tags'),
        type: z.enum(MEMORY_TYPES).optional().describe('New type'),
      },
    },
    async ({ id, title, description, content, tags, type }) => {
      try {
        const before = await ops.read(id);
        if (!before) throw new Error(`Memory not found: ${id}`);
        const updated = await ops.update(id, {
          title,
          description,
          content,
          tags,
          type,
        });
        const changes: string[] = [];
        if (title && title !== before.title)
          changes.push(`title: ${before.title} → ${title}`);
        if (description && description !== before.description)
          changes.push(
            `description: ${before.description ?? '(none)'} → ${description}`,
          );
        if (tags && JSON.stringify(tags) !== JSON.stringify(before.tags))
          changes.push(
            `tags: [${before.tags.join(', ')}] → [${tags.join(', ')}]`,
          );
        if (type && type !== before.type)
          changes.push(`type: ${before.type} → ${type}`);
        if (content && content !== before.content) {
          changes.push('content changed:');
          changes.push(unifiedDiff(before.content, content));
        }
        const diff = changes.length > 0 ? '\n\n' + changes.join('\n') : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated: ${updated.title}${diff}`,
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
