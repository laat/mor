import path from 'node:path';
import { EXT_TO_LANG } from './ext.js';

/**
 * Wrap content in a fenced code block based on file extension.
 * Markdown, text, and extensionless files are returned as-is.
 */
export function wrapCodeFence(content: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.txt' || ext === '') {
    return content;
  }
  const lang = EXT_TO_LANG[ext] ?? ext.slice(1);
  return '```' + lang + '\n' + content.replace(/\n$/, '') + '\n```';
}

/**
 * Extract code and language from a fenced code block.
 * Returns null if the content is not a single fenced block.
 */
export function stripCodeFence(
  content: string,
): { code: string; lang: string } | null {
  const match = content.match(/^```(\w*)\n([\s\S]*?)\n```\s*$/);
  if (!match) return null;
  return { code: match[2], lang: match[1] };
}
