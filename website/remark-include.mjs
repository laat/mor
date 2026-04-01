import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visit } from 'unist-util-visit';

const EXT_TO_LANG = {
  '.sh': 'bash',
  '.bash': 'bash',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
};

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Remark plugin that replaces `<!-- @include path/to/file -->` HTML comments
 * with fenced code blocks containing the file contents.
 * Paths are resolved relative to the repo root.
 */
export default function remarkInclude() {
  return (tree) => {
    visit(tree, 'html', (node, index, parent) => {
      const match = node.value.match(
        /^<!--\s*@include\s+(\S+?)(?:\s+(\w+))?\s*-->$/,
      );
      if (!match) return;

      const filePath = resolve(rootDir, match[1]);
      const lang = match[2] || EXT_TO_LANG[extname(filePath)] || '';

      const content = readFileSync(filePath, 'utf-8').trimEnd();
      parent.children[index] = {
        type: 'code',
        lang,
        value: content,
      };
    });
  };
}
