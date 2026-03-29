#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { loadConfig, isRemote } from "./config.js";
import { openDb } from "./db.js";
import { reindex } from "./index.js";
import { createMemory, listMemoryFiles } from "./memory.js";
import { syncIndex } from "./index.js";
import { LocalOperations, type Operations } from "./operations.js";
import { RemoteOperations } from "./remote.js";
import { startMcpServer } from "./mcp.js";
import { startServer } from "./server.js";

function getOps(config: ReturnType<typeof loadConfig>): Operations {
  if (isRemote(config)) return new RemoteOperations(config);
  return new LocalOperations(config);
}

const program = new Command();

program
  .name("code-memory")
  .description("A user-controlled memory bank for AI assistants")
  .version("0.1.0");

program
  .command("find <query>")
  .description("Search memories by query")
  .option("-l, --limit <n>", "Max results", "10")
  .action(async (query: string, opts: { limit: string }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const results = await ops.search(query, parseInt(opts.limit));
      if (results.length === 0) {
        console.log("No memories found.");
        return;
      }
      for (const r of results) {
        const tags = r.memory.tags.length > 0 ? ` [${r.memory.tags.join(", ")}]` : "";
        console.log(`${r.memory.id.slice(0, 8)}  ${r.memory.title}${tags}`);
        console.log(`         ${path.basename(r.memory.filePath)}`);
      }
    } finally {
      ops.close();
    }
  });

program
  .command("add [file]")
  .description("Add a new memory from file or stdin")
  .option("-t, --title <title>", "Memory title")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--type <type>", "Memory type", "knowledge")
  .action(async (file: string | undefined, opts: { title?: string; tags?: string; type: string }) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      let content: string;
      let title = opts.title;

      if (file && file !== "-") {
        content = fs.readFileSync(file, "utf-8");
        if (!title) title = path.basename(file);
      } else {
        // Read from stdin
        content = fs.readFileSync(0, "utf-8");
        if (!title) {
          console.error("Error: --title is required when reading from stdin");
          process.exit(1);
        }
      }

      const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()) : [];
      const mem = await ops.add({ title, content, tags, type: opts.type });
      console.log(`Created: ${mem.id.slice(0, 8)}  ${mem.title}`);
      console.log(`    ${path.basename(mem.filePath)}`);
    } finally {
      ops.close();
    }
  });

program
  .command("rm <query>")
  .description("Remove a memory")
  .action(async (query: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const result = await ops.remove(query);
      console.log(`Removed: ${result.title}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    } finally {
      ops.close();
    }
  });

program
  .command("cat <query>")
  .description("Print memory content (without frontmatter)")
  .action(async (query: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Memory not found: ${query}`);
        process.exit(1);
      }
      console.log(mem.content);
    } finally {
      ops.close();
    }
  });

program
  .command("cp <query> <dest>")
  .description("Copy memory content to a file")
  .action(async (query: string, dest: string) => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const mem = await ops.read(query);
      if (!mem) {
        console.error(`Memory not found: ${query}`);
        process.exit(1);
      }
      fs.writeFileSync(dest, mem.content + "\n");
      console.log(`Copied "${mem.title}" to ${dest}`);
    } finally {
      ops.close();
    }
  });

program
  .command("edit <query>")
  .description("Open memory in $EDITOR")
  .action(async (query: string) => {
    const config = loadConfig();
    if (isRemote(config)) {
      // Remote edit: fetch → temp file → $EDITOR → update via API
      const ops = new RemoteOperations(config);
      try {
        const mem = await ops.read(query);
        if (!mem) {
          console.error(`Memory not found: ${query}`);
          process.exit(1);
        }
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-memory-"));
        const tmpFile = path.join(tmpDir, path.basename(mem.filePath));
        fs.writeFileSync(tmpFile, mem.content);
        const editor = process.env.EDITOR ?? "vi";
        execSync(`${editor} ${tmpFile}`, { stdio: "inherit" });
        const newContent = fs.readFileSync(tmpFile, "utf-8");
        if (newContent !== mem.content) {
          await ops.update(mem.id, { content: newContent });
          console.log(`Updated: ${mem.title}`);
        } else {
          console.log("No changes.");
        }
        fs.rmSync(tmpDir, { recursive: true });
      } finally {
        ops.close();
      }
    } else {
      // Local edit: open file directly
      const ops = new LocalOperations(config);
      try {
        const mem = await ops.read(query);
        if (!mem) {
          console.error(`Memory not found: ${query}`);
          process.exit(1);
        }
        const editor = process.env.EDITOR ?? "vi";
        execSync(`${editor} ${mem.filePath}`, { stdio: "inherit" });
        // Re-sync after edit
        const db = openDb(config);
        try {
          syncIndex(config, db);
        } finally {
          db.close();
        }
      } finally {
        ops.close();
      }
    }
  });

program
  .command("reindex")
  .description("Rebuild the search index from memory files")
  .action(async () => {
    const config = loadConfig();
    if (isRemote(config)) {
      console.error("Error: reindex is only available in local mode");
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
  .command("import <dir>")
  .description("Import markdown files from a directory")
  .action((dir: string) => {
    const config = loadConfig();
    if (isRemote(config)) {
      console.error("Error: import is only available in local mode");
      process.exit(1);
    }
    const db = openDb(config);
    try {
      const absDir = path.resolve(dir);
      const files = fs.readdirSync(absDir).filter((f) => f.endsWith(".md"));
      let count = 0;
      for (const file of files) {
        const filePath = path.join(absDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const title = path.basename(file, ".md");
        createMemory(config, { title, content });
        count++;
      }
      syncIndex(config, db);
      console.log(`Imported ${count} memories.`);
    } finally {
      db.close();
    }
  });

program
  .command("mcp")
  .description("Start MCP server over stdio")
  .action(async () => {
    await startMcpServer();
  });

program
  .command("list")
  .description("List all memories")
  .action(async () => {
    const config = loadConfig();
    const ops = getOps(config);
    try {
      const memories = await ops.list();
      if (memories.length === 0) {
        console.log("No memories stored.");
        return;
      }
      for (const mem of memories) {
        const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
        console.log(`${mem.id.slice(0, 8)}  ${mem.title}${tags}`);
      }
    } finally {
      ops.close();
    }
  });

program
  .command("serve")
  .description("Start HTTP server for remote access")
  .option("-p, --port <port>", "Port to listen on", "7677")
  .option("-H, --host <host>", "Host to bind to", "0.0.0.0")
  .option("--token <token>", "Bearer token for authentication")
  .action((opts: { port: string; host: string; token?: string }) => {
    const config = loadConfig();
    const port = parseInt(opts.port) || config.serve?.port || 7677;
    const host = opts.host !== "0.0.0.0" ? opts.host : config.serve?.host || "0.0.0.0";
    const token = opts.token || config.serve?.token;
    startServer(config, { port, host, token });
  });

program.parse();
