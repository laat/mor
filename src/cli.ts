import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import matter from 'gray-matter';
import { getConfigDir, isRemote, loadConfig } from './config.js';
import { startMcpServer } from './mcp.js';
import { serializeMemory } from './memory.js';
import { login } from './oauth-login.js';
import { LocalOperations } from './operations-local.js';
import { RemoteOperations } from './operations-client.js';
import type { MemoryFilter, Operations } from './operations.js';
import { startServer } from './operations-server.js';
import { MEMORY_TYPES, type Memory, type MemoryType } from './operations.js';
import { EXT_TO_LANG, LANG_TO_EXT } from './utils/ext.js';
import { parseRawGitHubUrl } from './utils/github.js';
import { colorizeMarkdown, truncate } from './utils/ansi.js';
import { wrapCodeFence, stripCodeFence } from './utils/markdown.js';
import { version } from './version.js';

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
  if (isRemote(config)) return new RemoteOperations(config, getConfigDir());
  return new LocalOperations(config);
}

const program = new Command();

function addFilterOptions(cmd: Command): Command {
  return cmd
    .option('--type <type>', 'Filter by memory type (comma-separated, glob)')
    .option('--tag <pattern>', 'Filter by tag (comma-separated, AND, glob)')
    .option('--repo <pattern>', 'Filter by repository (glob)')
    .option('--ext <ext>', 'Filter by file extension in title');
}

function parseFilterOpts(opts: Record<string, any>): MemoryFilter {
  return {
    type: opts.type,
    tag: opts.tag
      ? opts.tag.split(',').map((t: string) => t.trim())
      : undefined,
    repo: opts.repo,
    ext: opts.ext,
  };
}

program
  .name(path.basename(process.argv[1]))
  .description('A shared memory store for humans and AI');

program
  .command('version')
  .description('Show version info')
  .action(async () => {
    console.log(`mor ${version}`);
    const config = loadConfig();
    if (isRemote(config)) {
      try {
        const res = await fetch(
          `${config.server!.url.replace(/\/+$/, '')}/health`,
          {
            headers: config.server!.token
              ? { Authorization: `Bearer ${config.server!.token}` }
              : {},
          },
        );
        const json = (await res.json()) as { version?: string };
        if (json.version) {
          console.log(`server ${json.version} (${config.server!.url})`);
        }
      } catch {
        console.log(`server unreachable (${config.server!.url})`);
      }
    }
  });

addFilterOptions(
  program
    .command('find <query>')
    .description('Search memories by query')
    .option('--limit <n>', 'Max results', '20')
    .option('-s, --threshold <n>', 'Minimum score (0-1)')
    .option('--json', 'Output as JSON (includes content)'),
).action(
  async (
    query: string,
    opts: { limit: string; threshold?: string; json?: boolean } & MemoryFilter,
  ) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const limitRaw = parseInt(opts.limit, 10);
      const page = await ops.search(
        query,
        Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw,
        parseFilterOpts(opts),
      );
      const threshold = opts.threshold
        ? parseFloat(opts.threshold)
        : (config.threshold ?? 0.3);
      const results = page.data.filter((r) => r.score >= threshold);
      if (opts.json) {
        const json = results.map((r) => ({
          id: r.memory.id,
          title: r.memory.title,
          description: r.memory.description ?? null,
          tags: r.memory.tags,
          score: r.score,
          content: r.memory.content,
        }));
        console.log(JSON.stringify(json));
        return;
      }
      if (results.length === 0) {
        console.log('No memories found.');
        return;
      }
      for (const r of results) {
        const tags =
          r.memory.tags.length > 0
            ? ` ${chalk.yellow(`[${r.memory.tags.join(', ')}]`)}`
            : '';
        const score = chalk.dim(`  (${r.score.toFixed(2)})`);
        console.log(
          truncate(
            `${chalk.cyan(r.memory.id.slice(0, 8))}  ${r.memory.title}${tags}${score}`,
          ),
        );
      }
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  },
);

addFilterOptions(
  program
    .command('grep <pattern>')
    .description('Search memories by substring or regex')
    .option('--limit <n>', 'Max results', '20')
    .option('-i, --ignore-case', 'Case-insensitive matching')
    .option('-E, --regex', 'Treat pattern as regex')
    .option('-w, --word-regexp', 'Match whole words only')
    .option('-n, --line-number', 'Show line numbers')
    .option('-A, --after-context <n>', 'Lines after match')
    .option('-B, --before-context <n>', 'Lines before match')
    .option('-C, --context <n>', 'Lines before and after match')
    .option(
      '-l, --files-with-matches',
      'Show only memory titles, no matching lines',
    ),
).action(
  async (
    pattern: string,
    opts: {
      limit: string;
      ignoreCase?: boolean;
      regex?: boolean;
      wordRegexp?: boolean;
      lineNumber?: boolean;
      afterContext?: string;
      beforeContext?: string;
      context?: string;
      filesWithMatches?: boolean;
    } & MemoryFilter,
  ) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const limitRaw = parseInt(opts.limit, 10);
      const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
      let grepPattern = pattern;
      let useRegex = opts.regex;
      if (opts.wordRegexp) {
        const escaped = useRegex
          ? pattern
          : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        grepPattern = `\\b${escaped}\\b`;
        useRegex = true;
      }
      const page = await ops.grep(grepPattern, {
        limit,
        ignoreCase: opts.ignoreCase,
        filter: parseFilterOpts(opts),
        regex: useRegex,
      });
      if (page.data.length === 0) {
        console.log('No memories found.');
        return;
      }
      const flags = opts.ignoreCase ? 'gi' : 'g';
      const re = useRegex
        ? new RegExp(grepPattern, flags)
        : new RegExp(grepPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

      for (const mem of page.data) {
        const tags =
          mem.tags.length > 0
            ? ` ${chalk.yellow(`[${mem.tags.join(', ')}]`)}`
            : '';
        console.log(`${chalk.cyan(mem.id.slice(0, 8))}  ${mem.title}${tags}`);
        if (opts.filesWithMatches) continue;
        const before =
          parseInt(opts.beforeContext ?? opts.context ?? '0', 10) || 0;
        const after =
          parseInt(opts.afterContext ?? opts.context ?? '0', 10) || 0;
        const lines = mem.content.split('\n');
        const numWidth = opts.lineNumber ? String(lines.length).length : 0;
        const highlighted = lines.map((line) => {
          let isMatch = false;
          const text = line.replace(re, (m) => {
            isMatch = true;
            return chalk.red(m);
          });
          return { text, isMatch };
        });
        let lastPrinted = -2;
        for (let i = 0; i < highlighted.length; i++) {
          if (!highlighted[i].isMatch) continue;
          const start = Math.max(0, i - before);
          const end = Math.min(highlighted.length - 1, i + after);
          if (lastPrinted >= 0 && start > lastPrinted + 1) {
            console.log(chalk.dim('  --'));
          }
          for (let j = start; j <= end; j++) {
            if (j <= lastPrinted) continue;
            lastPrinted = j;
            const lineText = highlighted[j].isMatch
              ? highlighted[j].text
              : chalk.dim(lines[j]);
            const prefix = opts.lineNumber
              ? chalk.dim(`${String(j + 1).padStart(numWidth)}: `)
              : '';
            console.log(`  ${prefix}${lineText}`);
          }
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
        console.log(
          `${chalk.green('Created:')} ${chalk.cyan(mem.id.slice(0, 8))}  ${mem.title}`,
        );
        console.log(`         ${chalk.dim(path.basename(mem.filePath))}`);
      } finally {
        ops.close();
      }
    },
  );

program
  .command('rm <id>')
  .description('Remove a memory by UUID or UUID prefix')
  .action(async (id: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const result = await ops.remove(id);
      console.log(
        `${chalk.green('Removed:')} ${chalk.cyan(result.id.slice(0, 8))}  ${result.title}`,
      );
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
  .option('--content-from <source>', 'Read content from file or URL')
  .action(
    async (
      query: string,
      opts: {
        title?: string;
        description?: string;
        tags?: string;
        type?: string;
        contentFrom?: string;
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
        if (opts.contentFrom) {
          const src = opts.contentFrom;
          if (/^https?:\/\//.test(src)) {
            const res = await fetch(src);
            if (!res.ok) {
              console.error(`Error: failed to fetch ${src} (${res.status})`);
              process.exit(1);
            }
            const raw = await res.text();
            const filename = path.basename(new URL(src).pathname) || src;
            updates.content = wrapCodeFence(raw, filename);
          } else {
            updates.content = wrapCodeFence(
              fs.readFileSync(src, 'utf-8'),
              path.basename(src),
            );
          }
        } else if (opts.contentFrom === '-') {
          updates.content = fs.readFileSync(0, 'utf-8');
        }
        if (Object.keys(updates).length === 0) {
          console.error(
            'Error: no updates provided. Use --title, --description, --tags, --type, or pipe content via stdin.',
          );
          process.exit(1);
        }
        const mem = await ops.update(query, updates);
        console.log(
          `${chalk.green('Updated:')} ${chalk.cyan(mem.id.slice(0, 8))}  ${mem.title}`,
        );
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
  .option('--links', 'Show links')
  .action(async (query: string, opts: { raw?: boolean; links?: boolean }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Error: memory not found: ${query}`);
        process.exit(1);
      }
      let output = exportMemory(mem, opts.raw);
      if (!opts.raw && process.stdout.isTTY) output = colorizeMarkdown(output);
      process.stdout.write(output);
      if (!opts.raw) process.stdout.write('\n');
      if (!opts.raw && opts.links) {
        const { forward, back } = await ops.getLinks(mem.id);
        if (forward.length > 0 || back.length > 0) {
          console.log(chalk.dim('---'));
          console.log(chalk.bold('Links:'));
          for (const link of forward) {
            const title = link.title || chalk.dim('(not found)');
            console.log(
              `${chalk.green('→')} ${chalk.cyan(link.id.slice(0, 8))}  ${title}`,
            );
          }
          for (const link of back) {
            console.log(
              `${chalk.blue('←')} ${chalk.cyan(link.id.slice(0, 8))}  ${link.title}`,
            );
          }
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
  .command('links [query]')
  .description('Show links for a memory, or list broken links')
  .option('--broken', 'List all memories with broken links')
  .action(async (query: string | undefined, opts: { broken?: boolean }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      if (opts.broken) {
        const page = await ops.list(undefined, 10000);
        let found = false;
        for (const mem of page.data) {
          const { forward } = await ops.getLinks(mem.id);
          const broken = forward.filter((l) => !l.title);
          if (broken.length > 0) {
            found = true;
            console.log(`${chalk.cyan(mem.id.slice(0, 8))}  ${mem.title}`);
            for (const link of broken) {
              console.log(
                `  ${chalk.red('→')} ${chalk.dim(link.id.slice(0, 8))}  ${chalk.dim('(not found)')}`,
              );
            }
          }
        }
        if (!found) console.log('No broken links found.');
        return;
      }
      if (!query) {
        console.error('Error: provide a memory ID, or use --broken');
        process.exit(1);
      }
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Error: memory not found: ${query}`);
        process.exit(1);
      }
      const { forward, back } = await ops.getLinks(mem.id);
      if (forward.length === 0 && back.length === 0) {
        console.log('No links.');
        return;
      }
      for (const link of forward) {
        const title = link.title || chalk.dim('(not found)');
        console.log(
          `${chalk.green('→')} ${chalk.cyan(link.id.slice(0, 8))}  ${title}`,
        );
      }
      for (const link of back) {
        console.log(
          `${chalk.blue('←')} ${chalk.cyan(link.id.slice(0, 8))}  ${link.title}`,
        );
      }
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
          const { data, content: newContent } = matter(edited);
          await ops.update(mem.id, {
            title: data.title,
            description: data.description,
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
    const ops = getOps(config);
    try {
      const result = await ops.reindex();
      console.log(`Reindexed ${result.count} memories.`);
      if (result.embedding) {
        const e = result.embedding;
        const url = e.baseUrl ?? e.provider;
        console.log(
          `Embeddings: ${e.provider} (${e.model}, ${e.dimensions}d) via ${url}`,
        );
      }
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    } finally {
      ops.close();
    }
  });

program
  .command('import <dir>')
  .description('Import markdown files from a directory')
  .action(async (dir: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const absDir = path.resolve(dir);
      const files = fs.readdirSync(absDir).filter((f) => f.endsWith('.md'));
      let count = 0;
      for (const file of files) {
        try {
          const filePath = path.join(absDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const title = path.basename(file, '.md');
          await ops.add({ title, content });
          count++;
        } catch (e) {
          console.error(
            `Error: failed to import ${file}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      console.log(`Imported ${count} memories.`);
    } finally {
      ops.close();
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
    .option('--limit <n>', 'Max results')
    .option('-a, --all', 'Show all (no limit)')
    .option('-l, --long', 'Show file path or URL')
    .option('--tags', 'List all tags with counts')
    .option('--types', 'List all types with counts'),
).action(
  async (
    opts: {
      limit?: string;
      all?: boolean;
      long?: boolean;
      tags?: boolean;
      types?: boolean;
    } & MemoryFilter,
  ) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      // For --tags/--types we need all memories, otherwise use limit
      const needAll = opts.tags || opts.types || opts.all;
      const limitRaw = opts.limit ? parseInt(opts.limit, 10) : undefined;
      const limit = needAll
        ? 10000
        : limitRaw && !Number.isNaN(limitRaw) && limitRaw >= 1
          ? limitRaw
          : 100;
      const page = await ops.list(parseFilterOpts(opts), limit);
      if (page.data.length === 0) {
        console.log('No memories stored.');
        return;
      }
      if (needAll) {
        const counts = new Map<string, number>();
        for (const mem of page.data) {
          if (opts.types) {
            counts.set(mem.type, (counts.get(mem.type) ?? 0) + 1);
          } else {
            for (const tag of mem.tags) {
              counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
          }
        }
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        for (const [key, count] of sorted) {
          console.log(`${chalk.bold(String(count).padStart(4))}  ${key}`);
        }
        return;
      }
      for (const mem of page.data) {
        if (opts.long) {
          const date = chalk.dim(mem.updated.slice(0, 10));
          const tags =
            mem.tags.length > 0
              ? `  ${chalk.yellow(`[${mem.tags.join(', ')}]`)}`
              : '';
          const loc = isRemote(config)
            ? `${config.server!.url.replace(/\/+$/, '')}/memories/${encodeURIComponent(mem.id)}`
            : mem.filePath;
          console.log(
            truncate(
              `${chalk.cyan(mem.id.slice(0, 8))}  ${chalk.magenta(mem.type.padEnd(10))}  ${date}  ${mem.title}${tags}`,
            ),
          );
          if (mem.description)
            console.log(truncate(`         ${chalk.dim(mem.description)}`));
          console.log(truncate(`         ${chalk.dim(loc)}`));
        } else {
          const desc = mem.description
            ? `  ${chalk.dim(`— ${mem.description}`)}`
            : '';
          console.log(
            truncate(`${chalk.cyan(mem.id.slice(0, 8))}  ${mem.title}${desc}`),
          );
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
  .command('sync')
  .description('Pull remote changes, commit and push local changes')
  .action(async () => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const result = await ops.sync();
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

program
  .command('login')
  .description('Authenticate with a remote mor server via OAuth')
  .option('-s, --server <url>', 'Server URL (defaults to config server.url)')
  .action(async (opts: { server?: string }) => {
    const config = loadConfig();
    const serverUrl = opts.server ?? config.server?.url;
    if (!serverUrl) {
      console.error(
        'Error: No server URL. Use --server <url> or set server.url in config.',
      );
      process.exit(1);
    }
    try {
      await login(serverUrl, getConfigDir());
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

program.parse();
