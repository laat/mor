import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import matter from "gray-matter";
import slugifyModule from "slugify";
const slugify = slugifyModule as unknown as (str: string, opts?: { lower?: boolean; strict?: boolean }) => string;
import { v4 as uuidv4 } from "uuid";
import type { Config, FrontMatter, Memory } from "./types.js";

export function detectRepository(): string | undefined {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    // Normalize git URLs to domain/path format
    return url
      .replace(/^https?:\/\//, "")
      .replace(/^git@/, "")
      .replace(/\.git$/, "")
      .replace(/:/, "/");
  } catch {
    return undefined;
  }
}

export function generateFilename(title: string, id: string): string {
  const slug = slugify(title, { lower: true, strict: true });
  const hash = id.slice(0, 8).replace(/-/g, "").slice(0, 4);
  return `${slug}-${hash}.md`;
}

export function createMemory(
  config: Config,
  opts: { title: string; content: string; tags?: string[]; type?: string; repository?: string },
): Memory {
  const id = uuidv4();
  const now = new Date().toISOString();
  const repo = opts.repository ?? detectRepository();
  const frontmatter: FrontMatter = {
    id,
    title: opts.title,
    tags: opts.tags ?? [],
    type: opts.type ?? "knowledge",
    ...(repo ? { repository: repo } : {}),
    created: now,
    updated: now,
  };

  const filename = generateFilename(opts.title, id);
  const filePath = path.join(config.memoryDir, filename);
  const fileContent = matter.stringify(opts.content, frontmatter);
  fs.writeFileSync(filePath, fileContent);

  return {
    ...frontmatter,
    content: opts.content,
    filePath,
  };
}

export function readMemory(filePath: string): Memory {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const fm = data as FrontMatter;
  return {
    id: fm.id,
    title: fm.title,
    tags: fm.tags ?? [],
    type: fm.type ?? "knowledge",
    repository: fm.repository,
    created: fm.created,
    updated: fm.updated,
    content: content.trim(),
    filePath,
  };
}

export function updateMemory(
  filePath: string,
  updates: { title?: string; content?: string; tags?: string[]; type?: string },
): Memory {
  const mem = readMemory(filePath);
  const now = new Date().toISOString();

  const frontmatter: FrontMatter = {
    id: mem.id,
    title: updates.title ?? mem.title,
    tags: updates.tags ?? mem.tags,
    type: updates.type ?? mem.type,
    ...(mem.repository ? { repository: mem.repository } : {}),
    created: mem.created,
    updated: now,
  };

  const content = updates.content ?? mem.content;
  const fileContent = matter.stringify(content, frontmatter);

  // If title changed, rename file
  let newPath = filePath;
  if (updates.title && updates.title !== mem.title) {
    const newFilename = generateFilename(updates.title, mem.id);
    newPath = path.join(path.dirname(filePath), newFilename);
    fs.unlinkSync(filePath);
  }

  fs.writeFileSync(newPath, fileContent);

  return {
    ...frontmatter,
    content,
    filePath: newPath,
  };
}

export function deleteMemory(filePath: string): void {
  fs.unlinkSync(filePath);
}

export function listMemoryFiles(config: Config): string[] {
  if (!fs.existsSync(config.memoryDir)) return [];
  return fs
    .readdirSync(config.memoryDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(config.memoryDir, f));
}
