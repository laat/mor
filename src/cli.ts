#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig, isRemote } from './config.js';
import { openDb } from './db.js';
import { reindex } from './index.js';
import { createMemory, listMemoryFiles } from './memory.js';
import { syncIndex } from './index.js';
import { LocalOperations, type Operations } from './operations.js';
import { RemoteOperations } from './remote.js';
import { startMcpServer } from './mcp.js';
import { startServer } from './server.js';

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

function getOps(config: ReturnType<typeof loadConfig>): Operations {
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

const program = new Command();

program
  .name('code-memory')
  .description('A user-controlled memory bank for AI assistants')
  .version('0.1.0');

program
  .command('find <query>')
  .description('Search memories by query')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (query: string, opts: { limit: string }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const limitRaw = parseInt(opts.limit, 10);
      const results = await ops.search(
        query,
        Number.isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw,
      );
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

program
  .command('add [file]')
  .description('Add a new memory from file or stdin')
  .option('-t, --title <title>', 'Memory title')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--type <type>', 'Memory type', 'knowledge')
  .action(
    async (
      file: string | undefined,
      opts: { title?: string; tags?: string; type: string },
    ) => {
      const config = loadConfig();
      const ops = getOps(config);
      try {
        let content: string;
        let title = opts.title;
        let repository: string | undefined;

        if (file && /^https?:\/\//.test(file)) {
          const res = await fetch(file);
          if (!res.ok) {
            console.error(`Error: failed to fetch ${file} (${res.status})`);
            process.exit(1);
          }
          content = await res.text();
          const urlInfo = parseRawGitHubUrl(file);
          if (urlInfo) {
            if (!title) title = urlInfo.filename;
            repository = urlInfo.repository;
          } else {
            if (!title) title = path.basename(new URL(file).pathname) || file;
          }
        } else if (file && file !== '-') {
          content = fs.readFileSync(file, 'utf-8');
          if (!title) title = path.basename(file);
        } else {
          content = fs.readFileSync(0, 'utf-8');
          if (!title) {
            console.error('Error: --title is required when reading from stdin');
            process.exit(1);
          }
        }

        const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [];
        const mem = await ops.add({
          title,
          content,
          tags,
          type: opts.type,
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
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--type <type>', 'Memory type')
  .action(
    async (
      query: string,
      opts: { title?: string; tags?: string; type?: string },
    ) => {
      const config = loadConfig();
      const ops = getOps(config);
      try {
        const updates: { title?: string; tags?: string[]; type?: string } = {};
        if (opts.title) updates.title = opts.title;
        if (opts.tags) updates.tags = opts.tags.split(',').map((t) => t.trim());
        if (opts.type) updates.type = opts.type;
        if (Object.keys(updates).length === 0) {
          console.error(
            'Error: no updates provided. Use --title, --tags, or --type.',
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
      if (opts.raw) {
        process.stdout.write(fs.readFileSync(mem.filePath, 'utf-8'));
      } else {
        console.log(mem.content);
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
      if (opts.raw) {
        fs.copyFileSync(mem.filePath, dest);
      } else {
        fs.writeFileSync(
          dest,
          mem.content.endsWith('\n') ? mem.content : mem.content + '\n',
        );
      }
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
  .action(async (query: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    let tmpDir: string | undefined;
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Error: memory not found: ${query}`);
        process.exit(1);
      }
      const editor = process.env.EDITOR ?? 'vi';
      if (isRemote(config)) {
        // Remote: fetch → temp file → $EDITOR → update via API
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-memory-'));
        const tmpFile = path.join(tmpDir, path.basename(mem.filePath));
        fs.writeFileSync(tmpFile, mem.content);
        spawnSync(editor, [tmpFile], { stdio: 'inherit', shell: true });
        const newContent = fs.readFileSync(tmpFile, 'utf-8');
        if (newContent !== mem.content) {
          await ops.update(mem.id, { content: newContent });
          console.log(`Updated: ${mem.title}`);
        } else {
          console.log('No changes.');
        }
      } else {
        // Local: open file directly
        spawnSync(editor, [mem.filePath], { stdio: 'inherit', shell: true });
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

program
  .command('list')
  .description('List all memories')
  .option('-l, --limit <n>', 'Max results')
  .action(async (opts: { limit?: string }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      let memories = await ops.list();
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
        const tags = mem.tags.length > 0 ? ` [${mem.tags.join(', ')}]` : '';
        console.log(`${mem.id.slice(0, 8)}  ${mem.title}${tags}`);
        console.log(`         ${path.basename(mem.filePath)}`);
      }
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
  .action((opts: { port?: string; host?: string; token?: string }) => {
    const config = loadConfig();
    const port =
      (opts.port ? parseInt(opts.port) : undefined) ??
      config.serve?.port ??
      7677;
    const host = opts.host ?? config.serve?.host ?? '127.0.0.1';
    const token = opts.token ?? config.serve?.token;
    startServer(config, { port, host, token });
  });

program.parse();
