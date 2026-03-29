import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { syncIndex, searchAsync } from "./index.js";
import { createMemory, readMemory, updateMemory, deleteMemory, listMemoryFiles } from "./memory.js";
import { resolveQuery } from "./query.js";
import type { Config } from "./types.js";
import type { DB } from "./db.js";

let testDir: string;
let config: Config;
let db: DB;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-memory-test-"));
  process.env.CODE_MEMORY_HOME = testDir;
  config = loadConfig();
  db = openDb(config);
});

afterEach(() => {
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.CODE_MEMORY_HOME;
});

describe("createMemory", () => {
  it("creates a markdown file with frontmatter", () => {
    const mem = createMemory(config, {
      title: "Test Memory",
      content: "Hello world",
      tags: ["test", "hello"],
      type: "knowledge",
    });

    expect(mem.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mem.title).toBe("Test Memory");
    expect(mem.tags).toEqual(["test", "hello"]);
    expect(mem.content).toBe("Hello world");
    expect(fs.existsSync(mem.filePath)).toBe(true);

    const raw = fs.readFileSync(mem.filePath, "utf-8");
    expect(raw).toContain("title: Test Memory");
    expect(raw).toContain("Hello world");
  });

  it("generates slug-based filename with hash", () => {
    const mem = createMemory(config, { title: "My Great Memory", content: "content" });
    const basename = path.basename(mem.filePath);
    expect(basename).toMatch(/^my-great-memory-[0-9a-f]{4}\.md$/);
  });
});

describe("readMemory", () => {
  it("parses frontmatter and content", () => {
    const created = createMemory(config, {
      title: "Read Test",
      content: "Some content here",
      tags: ["a", "b"],
    });

    const mem = readMemory(created.filePath);
    expect(mem.id).toBe(created.id);
    expect(mem.title).toBe("Read Test");
    expect(mem.tags).toEqual(["a", "b"]);
    expect(mem.content).toBe("Some content here");
  });
});

describe("updateMemory", () => {
  it("updates content and timestamp", () => {
    const mem = createMemory(config, { title: "Update Test", content: "old" });
    const updated = updateMemory(mem.filePath, { content: "new content" });
    expect(updated.content).toBe("new content");
    expect(updated.updated).not.toBe(mem.updated);
  });

  it("renames file when title changes", () => {
    const mem = createMemory(config, { title: "Old Title", content: "content" });
    const oldPath = mem.filePath;
    const updated = updateMemory(mem.filePath, { title: "New Title" });
    expect(updated.filePath).not.toBe(oldPath);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(updated.filePath)).toBe(true);
  });
});

describe("deleteMemory", () => {
  it("removes the file", () => {
    const mem = createMemory(config, { title: "Delete Me", content: "bye" });
    expect(fs.existsSync(mem.filePath)).toBe(true);
    deleteMemory(mem.filePath);
    expect(fs.existsSync(mem.filePath)).toBe(false);
  });
});

describe("listMemoryFiles", () => {
  it("lists all markdown files", () => {
    createMemory(config, { title: "A", content: "a" });
    createMemory(config, { title: "B", content: "b" });
    const files = listMemoryFiles(config);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".md"))).toBe(true);
  });
});

describe("syncIndex", () => {
  it("indexes new files", () => {
    createMemory(config, { title: "Sync Test", content: "indexed content" });
    syncIndex(config, db);

    const row = db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number };
    expect(row.count).toBe(1);
  });

  it("removes deleted files from index", () => {
    const mem = createMemory(config, { title: "Will Delete", content: "temp" });
    syncIndex(config, db);
    deleteMemory(mem.filePath);
    syncIndex(config, db);

    const row = db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number };
    expect(row.count).toBe(0);
  });
});

describe("search", () => {
  it("finds memories by FTS", async () => {
    createMemory(config, { title: "JavaScript Guide", content: "Learn JavaScript basics", tags: ["javascript"] });
    createMemory(config, { title: "Python Guide", content: "Learn Python basics", tags: ["python"] });
    syncIndex(config, db);

    const results = await searchAsync(config, db, "JavaScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].memory.title).toBe("JavaScript Guide");
  });
});

describe("resolveQuery", () => {
  it("resolves by full UUID", () => {
    const mem = createMemory(config, { title: "UUID Test", content: "content" });
    syncIndex(config, db);
    const found = resolveQuery(config, db, mem.id);
    expect(found?.id).toBe(mem.id);
  });

  it("resolves by UUID prefix", () => {
    const mem = createMemory(config, { title: "Prefix Test", content: "content" });
    syncIndex(config, db);
    const found = resolveQuery(config, db, mem.id.slice(0, 8));
    expect(found?.id).toBe(mem.id);
  });

  it("resolves by filename", () => {
    const mem = createMemory(config, { title: "Filename Test", content: "content" });
    syncIndex(config, db);
    const found = resolveQuery(config, db, path.basename(mem.filePath));
    expect(found?.id).toBe(mem.id);
  });

  it("resolves by search query", () => {
    createMemory(config, { title: "Unique Quantum Computing", content: "quantum entanglement" });
    syncIndex(config, db);
    const found = resolveQuery(config, db, "quantum");
    expect(found?.title).toBe("Unique Quantum Computing");
  });

  it("returns undefined for non-existent", () => {
    syncIndex(config, db);
    const found = resolveQuery(config, db, "nonexistent-thing-12345");
    expect(found).toBeUndefined();
  });
});
