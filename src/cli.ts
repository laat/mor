#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { syncIndex, reindex, search } from "./index.js";
import { createMemory, readMemory, deleteMemory, listMemoryFiles } from "./memory.js";
import { resolveQuery } from "./query.js";
import { startMcpServer } from "./mcp.js";

const program = new Command();

program
  .name("code-memory")
  .description("A user-controlled memory bank for AI assistants")
  .version("0.1.0");

program
  .command("find <query>")
  .description("Search memories by query")
  .option("-l, --limit <n>", "Max results", "10")
  .action((query: string, opts: { limit: string }) => {
    const config = loadConfig();
    const db = openDb(config);
    try {
      const results = search(config, db, query, parseInt(opts.limit));
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
      db.close();
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
    const db = openDb(config);
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
      const mem = createMemory(config, { title, content, tags, type: opts.type });
      syncIndex(config, db);
      console.log(`Created: ${mem.id.slice(0, 8)}  ${mem.title}`);
      console.log(`    ${path.basename(mem.filePath)}`);
    } finally {
      db.close();
    }
  });

program
  .command("rm <query>")
  .description("Remove a memory")
  .action((query: string) => {
    const config = loadConfig();
    const db = openDb(config);
    try {
      const mem = resolveQuery(config, db, query);
      if (!mem) {
        console.error(`Memory not found: ${query}`);
        process.exit(1);
      }
      deleteMemory(mem.filePath);
      syncIndex(config, db);
      console.log(`Removed: ${mem.title}`);
    } finally {
      db.close();
    }
  });

program
  .command("cat <query>")
  .description("Print memory content (without frontmatter)")
  .action((query: string) => {
    const config = loadConfig();
    const db = openDb(config);
    try {
      const mem = resolveQuery(config, db, query);
      if (!mem) {
        console.error(`Memory not found: ${query}`);
        process.exit(1);
      }
      console.log(mem.content);
    } finally {
      db.close();
    }
  });

program
  .command("cp <query> <dest>")
  .description("Copy memory content to a file")
  .action((query: string, dest: string) => {
    const config = loadConfig();
    const db = openDb(config);
    try {
      const mem = resolveQuery(config, db, query);
      if (!mem) {
        console.error(`Memory not found: ${query}`);
        process.exit(1);
      }
      fs.writeFileSync(dest, mem.content + "\n");
      console.log(`Copied "${mem.title}" to ${dest}`);
    } finally {
      db.close();
    }
  });

program
  .command("edit <query>")
  .description("Open memory in $EDITOR")
  .action((query: string) => {
    const config = loadConfig();
    const db = openDb(config);
    try {
      const mem = resolveQuery(config, db, query);
      if (!mem) {
        console.error(`Memory not found: ${query}`);
        process.exit(1);
      }
      const editor = process.env.EDITOR ?? "vi";
      execSync(`${editor} ${mem.filePath}`, { stdio: "inherit" });
      syncIndex(config, db);
    } finally {
      db.close();
    }
  });

program
  .command("reindex")
  .description("Rebuild the search index from memory files")
  .action(async () => {
    const config = loadConfig();
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
  .action(() => {
    const config = loadConfig();
    const db = openDb(config);
    try {
      syncIndex(config, db);
      const files = listMemoryFiles(config);
      if (files.length === 0) {
        console.log("No memories stored.");
        return;
      }
      for (const filePath of files) {
        try {
          const mem = readMemory(filePath);
          const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
          console.log(`${mem.id.slice(0, 8)}  ${mem.title}${tags}`);
        } catch {
          console.log(`  (error reading ${path.basename(filePath)})`);
        }
      }
    } finally {
      db.close();
    }
  });

program.parse();
