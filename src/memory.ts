import matter from 'gray-matter';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config, FrontMatter, Memory, MemoryType } from './operations.js';

export function detectRepository(): string | undefined {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^git@/, '')
      .replace(/\.git$/, '')
      .replace(/:(\d+:)?/, '/');
  } catch {
    return undefined;
  }
}

export function generateFilename(title: string, id: string): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'memory';
  const hash = id.slice(0, 8).replace(/-/g, '').slice(0, 4);
  return `${slug}-${hash}.md`;
}

function buildFrontmatter(fields: {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  type: MemoryType;
  repository?: string;
  created: string;
  updated: string;
}): FrontMatter {
  return {
    id: fields.id,
    title: fields.title,
    ...(fields.description ? { description: fields.description } : {}),
    tags: fields.tags,
    type: fields.type,
    ...(fields.repository ? { repository: fields.repository } : {}),
    created: fields.created,
    updated: fields.updated,
  };
}

export function createMemory(
  config: Config,
  opts: {
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    type?: MemoryType;
    repository?: string;
  },
): { mem: Memory; raw: string } {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const repo = opts.repository ?? detectRepository();
  const frontmatter = buildFrontmatter({
    id,
    title: opts.title,
    description: opts.description,
    tags: opts.tags ?? [],
    type: opts.type ?? 'knowledge',
    repository: repo,
    created: now,
    updated: now,
  });

  const filename = generateFilename(opts.title, id);
  const filePath = path.join(config.memoryDir, filename);
  const raw = matter.stringify(opts.content, frontmatter);
  fs.writeFileSync(filePath, raw);

  return {
    mem: { ...frontmatter, content: opts.content, filePath },
    raw,
  };
}

export function readMemory(filePath: string): Memory {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseMemory(raw, filePath);
}

export function readMemoryWithRaw(
  filePath: string,
): { mem: Memory; raw: string } | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return { mem: parseMemory(raw, filePath), raw };
  } catch (e) {
    process.stderr.write(
      `Warning: skipping unreadable memory ${filePath}: ${e instanceof Error ? e.message : e}\n`,
    );
    return undefined;
  }
}

function parseMemory(raw: string, filePath: string): Memory {
  const { data, content } = matter(raw);
  const fm = data as FrontMatter;
  return {
    id: fm.id,
    title: fm.title,
    description: fm.description,
    tags: fm.tags ?? [],
    type: fm.type ?? 'knowledge',
    repository: fm.repository,
    created: fm.created,
    updated: fm.updated,
    content: content.trim(),
    filePath,
  };
}

export function serializeMemory(mem: Memory): string {
  const frontmatter = buildFrontmatter(mem);
  return matter.stringify(mem.content, frontmatter);
}

export function updateMemory(
  filePath: string,
  updates: {
    title?: string;
    description?: string;
    content?: string;
    tags?: string[];
    type?: MemoryType;
  },
): { mem: Memory; raw: string } {
  const existing = readMemory(filePath);
  const now = new Date().toISOString();
  const description =
    updates.description !== undefined
      ? updates.description
      : existing.description;

  const frontmatter = buildFrontmatter({
    id: existing.id,
    title: updates.title ?? existing.title,
    description,
    tags: updates.tags ?? existing.tags,
    type: updates.type ?? existing.type,
    repository: existing.repository,
    created: existing.created,
    updated: now,
  });

  const content = updates.content ?? existing.content;
  const raw = matter.stringify(content, frontmatter);

  let newPath = filePath;
  if (updates.title && updates.title !== existing.title) {
    const newFilename = generateFilename(updates.title, existing.id);
    newPath = path.join(path.dirname(filePath), newFilename);
  }

  fs.writeFileSync(newPath, raw);
  if (newPath !== filePath) fs.unlinkSync(filePath);

  return {
    mem: { ...frontmatter, content, filePath: newPath },
    raw,
  };
}

export function deleteMemory(filePath: string): void {
  fs.unlinkSync(filePath);
}

export function listMemoryFiles(config: Config): string[] {
  if (!fs.existsSync(config.memoryDir)) return [];
  return fs
    .readdirSync(config.memoryDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(config.memoryDir, f));
}

export function safeReadMemory(filePath: string): Memory | undefined {
  return readMemoryWithRaw(filePath)?.mem;
}
