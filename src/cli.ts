#!/usr/bin/env node
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRemote, loadConfig } from './config.js';
import {
  addFilterOptions,
  filterMemories,
  filterResults,
  type MemoryFilter,
} from './filter.js';
import { openDb } from './db.js';
import { reindex, syncIndex } from './index.js';
import { startMcpServer } from './mcp.js';
import { createMemory, listMemoryFiles, serializeMemory } from './memory.js';
import { LocalOperations, type Operations } from './operations.js';
import { RemoteOperations } from './remote.js';
import { startServer } from './server.js';
import { MEMORY_TYPES, type Memory, type MemoryType } from './types.js';

function parseRawGitHubUrl(
  url: string,
): { filename: string; repository: string } | undefined {
  // https://raw.githubusercontent.com/{owner}/{repo}/refs/heads/{branch}/{path}
  // https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
  const m = url.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)/,
  );
  if (!m) return undefined;
  const [, owner, repo, rest] = m;
  // Strip query params, then extract filename from the remaining path
  const cleanPath = rest.split('?')[0];
  const filename = path.basename(cleanPath);
  return { filename, repository: `github.com/${owner}/${repo}` };
}

const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cs': 'csharp',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.sql': 'sql',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.clj': 'clojure',
  '.scala': 'scala',
  '.php': 'php',
  '.pl': 'perl',
  '.dockerfile': 'dockerfile',
  '.tf': 'hcl',
  '.zig': 'zig',
  '.nim': 'nim',
  '.dart': 'dart',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

function wrapCodeFence(content: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.txt' || ext === '') {
    return content;
  }
  const lang = EXT_TO_LANG[ext] ?? ext.slice(1);
  return '```' + lang + '\n' + content.replace(/\n$/, '') + '\n```';
}

const LANG_TO_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_TO_LANG).map(([ext, lang]) => [lang, ext]),
);

function stripCodeFence(
  content: string,
): { code: string; lang: string } | null {
  const match = content.match(/^```(\w*)\n([\s\S]*?)\n```\s*$/);
  if (!match) return null;
  return { code: match[2], lang: match[1] };
}

function openInEditor(file: string): void {
  const editor = process.env.EDITOR ?? 'vi';
  const quoted = `'${file.replace(/'/g, "'\\''")}'`;
  spawnSync(`${editor} ${quoted}`, { stdio: 'inherit', shell: true });
}

function parseType(value: string | undefined): MemoryType | undefined {
  if (!value) return undefined;
  if (MEMORY_TYPES.includes(value as MemoryType)) return value as MemoryType;
  console.error(
    `Error: invalid type '${value}'. Must be one of: ${MEMORY_TYPES.join(', ')}`,
  );
  process.exit(1);
}

function getOps(config: ReturnType<typeof loadConfig>): Operations {
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

const program = new Command();

program
  .name(path.basename(process.argv[1]))
  .description('A shared memory store for humans and AI')
  .version('0.1.0');

addFilterOptions(
  program
    .command('find <query>')
    .description('Search memories by query')
    .option('-l, --limit <n>', 'Max results', '20'),
).action(async (query: string, opts: { limit: string } & MemoryFilter) => {
  const config = loadConfig();
  const ops = getOps(config);
  try {
    const limitRaw = parseInt(opts.limit, 10);
    let results = await ops.search(
      query,
      Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw,
    );
    results = filterResults(results, opts);
    if (results.length === 0) {
      console.log('No memories found.');
      return;
    }
    for (const r of results) {
      const tags =
        r.memory.tags.length > 0 ? ` [${r.memory.tags.join(', ')}]` : '';
      console.log(`${r.memory.id.slice(0, 8)}  ${r.memory.title}${tags}`);
      console.log(`         ${path.basename(r.memory.filePath)}`);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  } finally {
    ops.close();
  }
});

addFilterOptions(
  program
    .command('grep <pattern>')
    .description('Search memories for literal substring matches')
    .option('-n, --limit <n>', 'Max results', '20')
    .option('-i, --ignore-case', 'Case-insensitive matching')
    .option('-l, --long', 'Show file path or URL'),
).action(
  async (
    pattern: string,
    opts: {
      limit: string;
      ignoreCase?: boolean;
      long?: boolean;
    } & MemoryFilter,
  ) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const limitRaw = parseInt(opts.limit, 10);
      const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
      let memories = await ops.grep(pattern, limit, opts.ignoreCase);
      memories = filterMemories(memories, opts);
      if (memories.length === 0) {
        console.log('No memories found.');
        return;
      }
      for (const mem of memories) {
        if (opts.long) {
          const tags = mem.tags.length > 0 ? ` [${mem.tags.join(', ')}]` : '';
          console.log(`${mem.id.slice(0, 8)}  ${mem.title}${tags}`);
          console.log(`         ${path.basename(mem.filePath)}`);
        } else {
          console.log(`${mem.id.slice(0, 8)}  ${mem.title}`);
        }
      }
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  },
);

program
  .command('add [file]')
  .description('Add a new memory from file or stdin')
  .option('-t, --title <title>', 'Memory title')
  .option('-d, --description <text>', 'Short description')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--type <type>', 'Memory type')
  .action(
    async (
      file: string | undefined,
      opts: {
        title?: string;
        description?: string;
        tags?: string;
        type?: string;
      },
      cmd: Command,
    ) => {
      if (!file && !opts.title && process.stdin.isTTY) {
        cmd.help();
        return;
      }
      const config = loadConfig();
      const ops = getOps(config);
      try {
        let content: string;
        let title = opts.title;
        let repository: string | undefined;
        const isFile = file && file !== '-';

        if (file && /^https?:\/\//.test(file)) {
          const res = await fetch(file);
          if (!res.ok) {
            console.error(`Error: failed to fetch ${file} (${res.status})`);
            process.exit(1);
          }
          const raw = await res.text();
          const urlInfo = parseRawGitHubUrl(file);
          let filename: string;
          if (urlInfo) {
            filename = urlInfo.filename;
            if (!title) title = filename;
            repository = urlInfo.repository;
          } else {
            filename = path.basename(new URL(file).pathname) || file;
            if (!title) title = filename;
          }
          content = wrapCodeFence(raw, filename);
        } else if (file && file !== '-') {
          content = wrapCodeFence(
            fs.readFileSync(file, 'utf-8'),
            path.basename(file),
          );
          if (!title) title = path.basename(file);
        } else if (!process.stdin.isTTY) {
          content = fs.readFileSync(0, 'utf-8');
          if (!title) {
            console.error('Error: --title is required when reading from stdin');
            process.exit(1);
          }
        } else {
          // Interactive with --title: open $EDITOR
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-'));
          const tmpFile = path.join(tmpDir, 'new-memory.md');
          fs.writeFileSync(tmpFile, '');
          openInEditor(tmpFile);
          content = fs.readFileSync(tmpFile, 'utf-8').trim();
          fs.rmSync(tmpDir, { recursive: true, force: true });
          if (!content) {
            console.log('Aborted: empty content.');
            return;
          }
        }

        const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [];
        const memType = parseType(opts.type) ?? (isFile ? 'file' : 'knowledge');
        if (memType === 'file' && title) {
          const ext = path.extname(title).toLowerCase();
          const lang = EXT_TO_LANG[ext];
          if (lang && !tags.includes(lang)) tags.push(lang);
        }
        const mem = await ops.add({
          title: title!,
          description: opts.description,
          content,
          tags,
          type: memType,
          repository,
        });
        console.log(`Created: ${mem.id.slice(0, 8)}  ${mem.title}`);
        console.log(`         ${path.basename(mem.filePath)}`);
      } finally {
        ops.close();
      }
    },
  );

program
  .command('rm <query>')
  .description('Remove a memory')
  .action(async (query: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const result = await ops.remove(query);
      console.log(`Removed: ${result.id.slice(0, 8)}  ${result.title}`);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  });

program
  .command('update <query>')
  .description("Update a memory's metadata or content")
  .option('-t, --title <title>', 'New title')
  .option('-d, --description <text>', 'Short description')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--type <type>', 'Memory type')
  .action(
    async (
      query: string,
      opts: {
        title?: string;
        description?: string;
        tags?: string;
        type?: string;
      },
    ) => {
      const config = loadConfig();
      const ops = getOps(config);
      try {
        const updates: {
          title?: string;
          description?: string;
          content?: string;
          tags?: string[];
          type?: MemoryType;
        } = {};
        if (opts.title) updates.title = opts.title;
        if (opts.description) updates.description = opts.description;
        if (opts.tags) updates.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.type) updates.type = parseType(opts.type);
        if (!process.stdin.isTTY) {
          updates.content = fs.readFileSync(0, 'utf-8');
        }
        if (Object.keys(updates).length === 0) {
          console.error(
            'Error: no updates provided. Use --title, --description, --tags, --type, or pipe content via stdin.',
          );
          process.exit(1);
        }
        const mem = await ops.update(query, updates);
        console.log(`Updated: ${mem.id.slice(0, 8)}  ${mem.title}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      } finally {
        ops.close();
      }
    },
  );

function exportMemory(mem: Memory, raw?: boolean): string {
  if (raw) return serializeMemory(mem);
  if (mem.type === 'file')
    return stripCodeFence(mem.content)?.code ?? mem.content;
  return mem.content;
}

program
  .command('cat <query>')
  .description('Print memory content')
  .option('--raw', 'Include frontmatter')
  .action(async (query: string, opts: { raw?: boolean }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Error: memory not found: ${query}`);
        process.exit(1);
      }
      process.stdout.write(exportMemory(mem, opts.raw));
      if (!opts.raw) process.stdout.write('\n');
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  });

program
  .command('cp <query> <dest>')
  .description('Copy memory content to a file')
  .option('--raw', 'Include frontmatter')
  .action(async (query: string, dest: string, opts: { raw?: boolean }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Error: memory not found: ${query}`);
        process.exit(1);
      }
      const output = exportMemory(mem, opts.raw);
      fs.writeFileSync(dest, output.endsWith('\n') ? output : output + '\n');
      console.log(`Copied "${mem.title}" to ${dest}`);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  });

program
  .command('edit <query>')
  .description('Open memory in $EDITOR')
  .option('--raw', 'Edit full file including frontmatter')
  .action(async (query: string, opts: { raw?: boolean }) => {
    const config = loadConfig();
    const ops = getOps(config);
    let tmpDir: string | undefined;
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Error: memory not found: ${query}`);
        process.exit(1);
      }

      if (opts.raw) {
        // Edit full file with frontmatter
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-'));
        const tmpFile = path.join(tmpDir, path.basename(mem.filePath));
        const original = serializeMemory(mem);
        fs.writeFileSync(tmpFile, original);
        openInEditor(tmpFile);
        const edited = fs.readFileSync(tmpFile, 'utf-8');
        if (edited !== original) {
          const { data, content: newContent } = (
            await import('gray-matter')
          ).default(edited);
          await ops.update(mem.id, {
            title: data.title,
            tags: data.tags,
            type: parseType(data.type),
            content: newContent.trim(),
          });
          console.log(`Updated: ${mem.title}`);
        } else {
          console.log('No changes.');
        }
      } else if (mem.type === 'file') {
        // For file type: edit the code without fence/frontmatter
        const fenced = stripCodeFence(mem.content);
        const code = fenced ? fenced.code : mem.content;
        const lang = fenced?.lang ?? '';
        const ext = LANG_TO_EXT[lang] ?? (lang ? `.${lang}` : '.txt');

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-'));
        const tmpFile = path.join(
          tmpDir,
          path.basename(mem.title, path.extname(mem.title)) + ext,
        );
        fs.writeFileSync(tmpFile, code);
        openInEditor(tmpFile);
        const edited = fs.readFileSync(tmpFile, 'utf-8');
        if (edited !== code) {
          const newContent = fenced
            ? '```' + lang + '\n' + edited.replace(/\n$/, '') + '\n```'
            : edited;
          await ops.update(mem.id, { content: newContent });
          console.log(`Updated: ${mem.title}`);
        } else {
          console.log('No changes.');
        }
      } else if (isRemote(config)) {
        // Remote non-file: edit content in temp file
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-'));
        const tmpFile = path.join(tmpDir, path.basename(mem.filePath));
        fs.writeFileSync(tmpFile, mem.content);
        openInEditor(tmpFile);
        const newContent = fs.readFileSync(tmpFile, 'utf-8');
        if (newContent !== mem.content) {
          await ops.update(mem.id, { content: newContent });
          console.log(`Updated: ${mem.title}`);
        } else {
          console.log('No changes.');
        }
      } else {
        // Local non-file: open markdown file directly
        openInEditor(mem.filePath);
      }
    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      ops.close();
    }
  });

program
  .command('reindex')
  .description('Rebuild the search index from memory files')
  .action(async () => {
    const config = loadConfig();
    if (isRemote(config)) {
      console.error('Error: reindex is only available in local mode');
      process.exit(1);
    }
    const db = openDb(config);
    try {
      await reindex(config, db);
      const files = listMemoryFiles(config);
      console.log(`Reindexed ${files.length} memories.`);
    } finally {
      db.close();
    }
  });

program
  .command('import <dir>')
  .description('Import markdown files from a directory')
  .action((dir: string) => {
    const config = loadConfig();
    if (isRemote(config)) {
      console.error('Error: import is only available in local mode');
      process.exit(1);
    }
    const db = openDb(config);
    try {
      const absDir = path.resolve(dir);
      const files = fs.readdirSync(absDir).filter((f) => f.endsWith('.md'));
      let count = 0;
      for (const file of files) {
        try {
          const filePath = path.join(absDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const title = path.basename(file, '.md');
          createMemory(config, { title, content });
          count++;
        } catch (e) {
          console.error(
            `Error: failed to import ${file}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      syncIndex(config, db);
      console.log(`Imported ${count} memories.`);
    } finally {
      db.close();
    }
  });

program
  .command('mcp')
  .description('Start MCP server over stdio')
  .action(async () => {
    await startMcpServer();
  });

addFilterOptions(
  program
    .command('ls')
    .description('List all memories')
    .option('-n, --limit <n>', 'Max results')
    .option('-l, --long', 'Show file path or URL'),
).action(async (opts: { limit?: string; long?: boolean } & MemoryFilter) => {
  const config = loadConfig();
  const ops = getOps(config);
  try {
    let memories = await ops.list();
    memories = filterMemories(memories, opts);
    if (memories.length === 0) {
      console.log('No memories stored.');
      return;
    }
    if (opts.limit) {
      const limitRaw = parseInt(opts.limit, 10);
      const limit =
        Number.isNaN(limitRaw) || limitRaw < 1 ? memories.length : limitRaw;
      memories = memories.slice(0, limit);
    }
    for (const mem of memories) {
      if (opts.long) {
        const date = mem.updated.slice(0, 10);
        const tags = mem.tags.length > 0 ? `  [${mem.tags.join(', ')}]` : '';
        const loc = isRemote(config)
          ? `${config.server!.url.replace(/\/+$/, '')}/memories/${encodeURIComponent(mem.id)}`
          : mem.filePath;
        console.log(
          `${mem.id.slice(0, 8)}  ${mem.type.padEnd(10)}  ${date}  ${mem.title}${tags}`,
        );
        if (mem.description) console.log(`         ${mem.description}`);
        console.log(`         ${loc}`);
      } else {
        const desc = mem.description ? `  — ${mem.description}` : '';
        console.log(`${mem.id.slice(0, 8)}  ${mem.title}${desc}`);
      }
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  } finally {
    ops.close();
  }
});

program
  .command('push')
  .description('Commit and push the memory folder if it is a git repo')
  .action(async () => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const result = await ops.push();
      console.log(result.message);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  });

program
  .command('serve')
  .description('Start HTTP server for remote access')
  .option('-p, --port <port>', 'Port to listen on')
  .option('-H, --host <host>', 'Host to bind to')
  .option('--token <token>', 'Bearer token for authentication')
  .option('--mcp', 'Enable MCP protocol endpoint at /mcp')
  .action(
    (opts: { port?: string; host?: string; token?: string; mcp?: boolean }) => {
      const config = loadConfig();
      const port =
        (opts.port ? parseInt(opts.port) : undefined) ??
        config.serve?.port ??
        7677;
      const host = opts.host ?? config.serve?.host ?? '127.0.0.1';
      const token = opts.token ?? config.serve?.token;
      const mcp = opts.mcp ?? config.serve?.mcp ?? false;
      startServer(config, { port, host, token, mcp });
    },
  );

program.parse();
