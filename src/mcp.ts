import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { isRemote, loadConfig } from './config.js';
import { filterMemories, filterResults } from './filter.js';
import { LocalOperations, type Operations } from './operations.js';
import { RemoteOperations } from './remote.js';
import { MEMORY_TYPES } from './types.js';

function simpleDiff(a: string, b: string): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const lines: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (i >= aLines.length) {
      lines.push(`+ ${bLines[i]}`);
    } else if (i >= bLines.length) {
      lines.push(`- ${aLines[i]}`);
    } else if (aLines[i] !== bLines[i]) {
      lines.push(`- ${aLines[i]}`);
      lines.push(`+ ${bLines[i]}`);
    }
  }
  return lines.join('\n');
}

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
        'Search memories by query. Returns the top result with full content, and summaries for the rest. Use memory_read to get full content of other results.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 20)'),
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
        type: z.string().optional().describe('Filter by memory type'),
      },
    },
    async ({ query, limit, tag, type }) => {
      let results = await ops.search(query, limit ?? 20);
      if (tag || type) results = filterResults(results, { tag, type });
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
    'memory_grep',
    {
      description:
        'Literal substring search across memory content. Use for exact strings, code identifiers, URLs. Returns top result with full content.',
      inputSchema: {
        pattern: z.string().describe('Literal substring to search for'),
        limit: z.number().optional().describe('Max results (default 20)'),
        ignore_case: z
          .boolean()
          .optional()
          .describe('Case-insensitive (default false)'),
        tag: z.string().optional().describe('Filter by tag (glob pattern)'),
      },
    },
    async ({ pattern, limit, ignore_case, tag }) => {
      let memories = await ops.grep(pattern, limit ?? 20, ignore_case);
      if (tag) memories = filterMemories(memories, { tag });
      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories found.' }],
        };
      }
      const lines = memories.map((mem, i) => {
        const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
        const desc = mem.description ? `\n  ${mem.description}` : '';
        const preview =
          i > 0 && !mem.description
            ? `\n  ${mem.content.split('\n')[0].slice(0, 100)}`
            : '';
        const body = i === 0 ? `\n\n${mem.content}` : '';
        return `- ${mem.id.slice(0, 8)}  ${mem.title}${tags}${desc}${preview}${body}`;
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
        type: z.string().optional().describe('Filter by memory type'),
      },
    },
    async ({ tag, type }) => {
      let memories = await ops.list();
      if (tag || type) memories = filterMemories(memories, { tag, type });
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
        const before = await ops.read(query);
        if (!before) throw new Error(`Memory not found: ${query}`);
        const updated = await ops.update(before.id, {
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
          changes.push(simpleDiff(before.content, content));
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
