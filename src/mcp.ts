import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isRemote, loadConfig } from './config.js';
import { LocalOperations } from './operations-local.js';
import { RemoteOperations } from './operations-client.js';
import {
  MEMORY_TYPES,
  type Memory,
  type Operations,
  type Paginated,
} from './operations.js';
import { unifiedDiff } from './utils/diff.js';

function createOps(): Operations {
  const config = loadConfig();
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

import { version } from './version.js';

// ---- Response helpers ----

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function error(e: unknown) {
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

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatMemory(mem: Memory): string {
  const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
  const desc = mem.description ? `\n  ${mem.description}` : '';
  return `- ${shortId(mem.id)}  ${mem.title}${tags}${desc}`;
}

function paginatedHeader<T>(page: Paginated<T>): string {
  return `Showing ${page.offset + 1}–${page.offset + page.data.length} of ${page.total} results\n\n`;
}

// ---- Server ----

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
        tag: z
          .array(z.string())
          .optional()
          .describe('Filter by tags (AND logic, glob patterns supported)'),
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
      if (page.data.length === 0) return text('No memories found.');
      const lines = page.data.map((r) => {
        const score = `  (${r.score.toFixed(2)})`;
        return formatMemory(r.memory) + score;
      });
      const top = page.data[0];
      const topContent = `\n\n---\n\nTop result: ${shortId(top.memory.id)}  ${top.memory.title}\n\n${top.memory.content}`;
      return text(paginatedHeader(page) + lines.join('\n') + topContent);
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
        tag: z
          .array(z.string())
          .optional()
          .describe('Filter by tags (AND logic, glob patterns supported)'),
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
      if (page.data.length === 0) return text('No memories found.');
      const lines = page.data.map(formatMemory);
      const top = page.data[0];
      const topContent = `\n\n---\n\nTop result: ${shortId(top.id)}  ${top.title}\n\n${top.content}`;
      return text(paginatedHeader(page) + lines.join('\n') + topContent);
    },
  );

  server.registerTool(
    'memory_read',
    {
      description: 'Read full content of one or more memories by ID.',
      inputSchema: {
        ids: z
          .array(z.string())
          .describe(
            'UUIDs of the memories to read — pass an array, e.g. ["id1", "id2"]',
          ),
      },
    },
    async ({ ids }) => {
      if (ids.length === 0)
        return { ...text('No ids provided.'), isError: true };
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
          ...text(`Memory not found: ${notFound.join(', ')}`),
          isError: true,
        };
      }
      const result =
        sections.join('\n\n---\n\n') +
        (notFound.length > 0
          ? `\n\n---\n\nNot found: ${notFound.join(', ')}`
          : '');
      return text(result);
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
        return text(`Created: ${mem.title} (${mem.id})`);
      } catch (e) {
        return error(e);
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
        return text(`Removed: ${result.title} (${result.id})`);
      } catch (e) {
        return error(e);
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
        tag: z
          .array(z.string())
          .optional()
          .describe('Filter by tags (AND logic, glob patterns supported)'),
        type: z.string().optional().describe('Filter by memory type'),
      },
    },
    async ({ limit, offset, tag, type }) => {
      const page = await ops.list({ tag, type }, limit ?? 100, offset ?? 0);
      if (page.data.length === 0) return text('No memories stored.');
      const lines = page.data.map(formatMemory);
      return text(paginatedHeader(page) + lines.join('\n'));
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
        const meta: string[] = [];
        if (title && title !== before.title)
          meta.push(`title: ${before.title} → ${title}`);
        if (description && description !== before.description)
          meta.push(
            `description: ${before.description ?? '(none)'} → ${description}`,
          );
        if (tags && JSON.stringify(tags) !== JSON.stringify(before.tags))
          meta.push(`tags: [${before.tags.join(', ')}] → [${tags.join(', ')}]`);
        if (type && type !== before.type)
          meta.push(`type: ${before.type} → ${type}`);
        const contentChanged = content && content !== before.content;
        if (meta.length === 0 && !contentChanged) {
          return text(
            `No changes: ${before.title} (fields match current values)`,
          );
        }
        const parts = [`Updated: ${updated.title}`];
        if (meta.length > 0) parts.push(meta.join('\n'));
        if (contentChanged) {
          parts.push('--- content diff ---');
          parts.push(unifiedDiff(before.content, content));
        }
        return text(parts.join('\n\n'));
      } catch (e) {
        return error(e);
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
