import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getStateDir, isRemote, loadConfig } from './config.js';
import { LocalOperations } from './operations-local.js';
import { RemoteOperations } from './operations-client.js';
import {
  MEMORY_TYPES,
  type Memory,
  type Operations,
  type Paginated,
} from './operations.js';
import { unifiedDiff } from './utils/diff.js';

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

// Accept either `id` (single) or `ids` (array) — or both, merged.
// Throws if neither was provided.
function resolveIds(input: { id?: string; ids?: string[] }): string[] {
  const merged: string[] = [];
  if (input.id) merged.push(input.id);
  if (input.ids) merged.push(...input.ids);
  if (merged.length === 0) {
    throw new Error('Provide either `id` (single) or `ids` (array).');
  }
  return merged;
}

const idOrIdsSchema = {
  id: z.string().optional().describe('UUID of the note. Alternative to `ids`.'),
  ids: z
    .array(z.string())
    .optional()
    .describe(
      'Array of UUIDs to operate on in one call. Alternative to `id`. Pass an array, e.g. ["id1", "id2"].',
    ),
};

function formatMemory(mem: Memory): string {
  const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
  const desc = mem.description ? `\n  ${mem.description}` : '';
  return `- ${shortId(mem.id)}  ${mem.title}${tags}${desc}`;
}

function paginatedHeader<T>(page: Paginated<T>): string {
  return `Showing ${page.offset + 1}–${page.offset + page.data.length} of ${page.total} results\n\n`;
}

// ---- Server ----

async function formatLinks(
  ops: Operations,
  memId: string,
): Promise<string | undefined> {
  const { forward, back } = await ops.getLinks(memId);
  if (forward.length === 0 && back.length === 0) return undefined;
  const forwardIds = new Set(forward.map((l) => l.id));
  const backIds = new Set(back.map((l) => l.id));
  const lines: string[] = ['Links:'];
  for (const link of forward) {
    const title = link.title || '(not found)';
    if (backIds.has(link.id)) {
      lines.push(`↔ ${shortId(link.id)}  ${title}`);
    } else {
      lines.push(`→ ${shortId(link.id)}  ${title}`);
    }
  }
  for (const link of back) {
    if (!forwardIds.has(link.id)) {
      lines.push(`← ${shortId(link.id)}  ${link.title}`);
    }
  }
  return lines.join('\n');
}

function formatMetadata(mem: Memory): string {
  const lines: string[] = [];
  lines.push(`id: ${shortId(mem.id)}`);
  lines.push(`title: ${mem.title}`);
  if (mem.tags.length > 0) lines.push(`tags: ${mem.tags.join(', ')}`);
  if (mem.type) lines.push(`type: ${mem.type}`);
  if (mem.description) lines.push(`description: ${mem.description}`);
  if (mem.created) lines.push(`created: ${mem.created}`);
  if (mem.updated) lines.push(`updated: ${mem.updated}`);
  return lines.join('\n');
}

export function createMcpServer(ops: Operations): McpServer {
  const server = new McpServer({
    name: 'mor',
    version,
    description:
      "The user's primary note store. Contains saved code snippets, files, preferences, and reference notes. Check here first when the user asks to recall, find, or reuse something they previously saved.",
  });

  server.registerTool(
    'notes_search',
    {
      description:
        'Semantic search over notes using natural language. Best for finding notes about a topic. Returns scored, ranked results with the top result shown in full.',
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
          .describe(
            'Filter by tags (AND logic, glob patterns supported) — pass an array, e.g. ["tag1", "tag2"]',
          ),
        type: z.string().optional().describe('Filter by note type'),
      },
    },
    async ({ query, limit, offset, tag, type }) => {
      const page = await ops.search(
        query,
        limit ?? 20,
        { tag, type },
        offset ?? 0,
      );
      if (page.data.length === 0) return text('No notes found.');
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
    'notes_grep',
    {
      description:
        'Exact text search over note content and titles. Use when you know the precise string, identifier, URL, or regex pattern to match. Unlike notes_search, this finds literal text rather than semantically similar content.',
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
          .describe(
            'Filter by tags (AND logic, glob patterns supported) — pass an array, e.g. ["tag1", "tag2"]',
          ),
        type: z.string().optional().describe('Filter by note type'),
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
      if (page.data.length === 0) return text('No notes found.');
      const lines = page.data.map(formatMemory);
      const top = page.data[0];
      const topContent = `\n\n---\n\nTop result: ${shortId(top.id)}  ${top.title}\n\n${top.content}`;
      return text(paginatedHeader(page) + lines.join('\n') + topContent);
    },
  );

  server.registerTool(
    'notes_read',
    {
      description:
        'Read full content of one or more notes by ID. Pass `id` for a single note or `ids` for several in one call.',
      inputSchema: idOrIdsSchema,
    },
    async ({ id, ids }) => {
      let resolved: string[];
      try {
        resolved = resolveIds({ id, ids });
      } catch (e) {
        return { ...error(e), isError: true };
      }
      const blocks: Array<{ type: 'text'; text: string }> = [];
      const notFound: string[] = [];
      for (const memId of resolved) {
        const mem = await ops.read(memId);
        if (!mem) {
          notFound.push(memId);
          continue;
        }
        blocks.push({ type: 'text', text: formatMetadata(mem) });
        blocks.push({ type: 'text', text: mem.content });
        const links = await formatLinks(ops, mem.id);
        if (links) blocks.push({ type: 'text', text: links });
      }
      if (blocks.length === 0) {
        return {
          ...text(`Note not found: ${notFound.join(', ')}`),
          isError: true,
        };
      }
      if (notFound.length > 0) {
        blocks.push({
          type: 'text',
          text: `Not found: ${notFound.join(', ')}`,
        });
      }
      return { content: blocks };
    },
  );

  server.registerTool(
    'notes_create',
    {
      description:
        'Create a new note with title, content, optional tags and type.',
      inputSchema: {
        title: z.string().describe('Note title'),
        description: z.string().optional().describe('Short description'),
        content: z.string().describe('Note content (markdown)'),
        tags: z
          .array(z.string())
          .nullish()
          .describe('Tags — pass an array, e.g. ["tag1", "tag2"]'),
        type: z
          .enum(MEMORY_TYPES)
          .nullish()
          .describe('Note type (default: knowledge)'),
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
    'notes_remove',
    {
      description:
        'Delete one or more notes by ID. Pass `id` for a single note or `ids` for several. Use notes_search to find IDs first.',
      inputSchema: idOrIdsSchema,
    },
    async ({ id, ids }) => {
      let resolved: string[];
      try {
        resolved = resolveIds({ id, ids });
      } catch (e) {
        return { ...error(e), isError: true };
      }
      const removed: string[] = [];
      const failures: { id: string; message: string }[] = [];
      for (const memId of resolved) {
        try {
          const result = await ops.remove(memId);
          removed.push(`${result.title} (${shortId(result.id)})`);
        } catch (e) {
          failures.push({
            id: memId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (removed.length === 0) {
        const lines = ['Failed to remove any notes:'];
        for (const f of failures) lines.push(`- ${f.id}: ${f.message}`);
        return { ...text(lines.join('\n')), isError: true };
      }
      const lines = [`Removed: ${removed.join(', ')}`];
      if (failures.length > 0) {
        lines.push('', 'Failures:');
        for (const f of failures) lines.push(`- ${f.id}: ${f.message}`);
      }
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'notes_list',
    {
      description:
        'List all notes with titles, IDs, and tags. Use tag/type params to filter.',
      inputSchema: {
        limit: z.number().optional().describe('Max results (default 100)'),
        offset: z
          .number()
          .optional()
          .describe('Skip first N results (default 0)'),
        tag: z
          .array(z.string())
          .optional()
          .describe(
            'Filter by tags (AND logic, glob patterns supported) — pass an array, e.g. ["tag1", "tag2"]',
          ),
        type: z.string().optional().describe('Filter by note type'),
      },
    },
    async ({ limit, offset, tag, type }) => {
      const page = await ops.list({ tag, type }, limit ?? 100, offset ?? 0);
      if (page.data.length === 0) return text('No notes stored.');
      const lines = page.data.map(formatMemory);
      return text(paginatedHeader(page) + lines.join('\n'));
    },
  );

  server.registerTool(
    'notes_update',
    {
      description:
        'Update one or more notes by ID. Pass `id` for a single note or `ids` to apply the same field changes to several notes. Only the provided fields are changed.',
      inputSchema: {
        ...idOrIdsSchema,
        title: z.string().optional().describe('New title'),
        description: z.string().optional().describe('New description'),
        content: z.string().optional().describe('New content'),
        tags: z
          .array(z.string())
          .optional()
          .describe('New tags — pass an array, e.g. ["tag1", "tag2"]'),
        type: z.enum(MEMORY_TYPES).optional().describe('New type'),
      },
    },
    async ({ id, ids, title, description, content, tags, type }) => {
      let resolved: string[];
      try {
        resolved = resolveIds({ id, ids });
      } catch (e) {
        return { ...error(e), isError: true };
      }
      const blocks: string[] = [];
      const failures: { id: string; message: string }[] = [];
      for (const memId of resolved) {
        try {
          const before = await ops.read(memId);
          if (!before) throw new Error(`Note not found: ${memId}`);
          const updated = await ops.update(memId, {
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
            meta.push(
              `tags: [${before.tags.join(', ')}] → [${tags.join(', ')}]`,
            );
          if (type && type !== before.type)
            meta.push(`type: ${before.type} → ${type}`);
          const contentChanged = content && content !== before.content;
          if (meta.length === 0 && !contentChanged) {
            blocks.push(
              `No changes: ${before.title} (fields match current values)`,
            );
            continue;
          }
          const parts = [`Updated: ${updated.title} (${shortId(updated.id)})`];
          if (meta.length > 0) parts.push(meta.join('\n'));
          if (contentChanged) {
            parts.push('--- content diff ---');
            parts.push(unifiedDiff(before.content, content));
          }
          blocks.push(parts.join('\n\n'));
        } catch (e) {
          failures.push({
            id: memId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (blocks.length === 0) {
        const lines = ['Failed to update any notes:'];
        for (const f of failures) lines.push(`- ${f.id}: ${f.message}`);
        return { ...text(lines.join('\n')), isError: true };
      }
      const out = [blocks.join('\n\n---\n\n')];
      if (failures.length > 0) {
        out.push('', 'Failures:');
        for (const f of failures) out.push(`- ${f.id}: ${f.message}`);
      }
      return text(out.join('\n'));
    },
  );

  server.registerTool(
    'notes_patch',
    {
      description:
        'Apply a str_replace patch to one or more notes. Pass `id` for a single note or `ids` to apply the same patch to several. The old_str must appear exactly once in each note. Use empty new_str to delete text.',
      inputSchema: {
        ...idOrIdsSchema,
        old_str: z
          .string()
          .describe('Exact substring to find (must be unique in each note)'),
        new_str: z
          .string()
          .describe('Replacement string (empty string to delete)'),
      },
    },
    async ({ id, ids, old_str, new_str }) => {
      let resolved: string[];
      try {
        resolved = resolveIds({ id, ids });
      } catch (e) {
        return { ...error(e), isError: true };
      }
      const blocks: string[] = [];
      const failures: { id: string; message: string }[] = [];
      for (const memId of resolved) {
        try {
          const before = await ops.read(memId);
          if (!before) throw new Error(`Note not found: ${memId}`);
          const updated = await ops.patch(memId, old_str, new_str);
          const parts = [`Patched: ${updated.title} (${shortId(updated.id)})`];
          parts.push('--- content diff ---');
          parts.push(unifiedDiff(before.content, updated.content));
          blocks.push(parts.join('\n\n'));
        } catch (e) {
          failures.push({
            id: memId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (blocks.length === 0) {
        const lines = ['Failed to patch any notes:'];
        for (const f of failures) lines.push(`- ${f.id}: ${f.message}`);
        return { ...text(lines.join('\n')), isError: true };
      }
      const out = [blocks.join('\n\n---\n\n')];
      if (failures.length > 0) {
        out.push('', 'Failures:');
        for (const f of failures) out.push(`- ${f.id}: ${f.message}`);
      }
      return text(out.join('\n'));
    },
  );

  return server;
}

function getOps(config: ReturnType<typeof loadConfig>): Operations {
  if (isRemote(config)) return new RemoteOperations(config, getStateDir());
  return new LocalOperations(config);
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();
  const ops = getOps(config);
  const server = createMcpServer(ops);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
