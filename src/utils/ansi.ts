import chalk from 'chalk';

export const ANSI_RE = /\x1b\[[0-9;]*m/g;
// eslint-disable-next-line no-control-regex
export const ANSI_START_RE = /^\x1b\[[0-9;]*m/;

/**
 * Truncate a string with ANSI escape codes to fit within a column width.
 * Adds an ellipsis and resets ANSI styles if truncated.
 */
export function truncate(line: string, cols = process.stdout.columns): string {
  if (!cols) return line;
  const visible = line.replace(ANSI_RE, '');
  if (visible.length <= cols) return line;
  // Walk the original string, counting visible chars
  let vis = 0;
  let i = 0;
  while (i < line.length && vis < cols - 1) {
    const m = line.slice(i).match(ANSI_START_RE);
    if (m) {
      i += m[0].length;
    } else {
      vis++;
      i++;
    }
  }
  return line.slice(0, i) + '\x1b[0m…';
}

/**
 * Apply basic syntax highlighting to markdown text for terminal output.
 */
export function colorizeMarkdown(text: string): string {
  let inCodeBlock = false;
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return chalk.dim(line);
      }
      if (inCodeBlock) return line;
      if (/^#{1,6}\s/.test(line)) return chalk.bold.green(line);
      if (/^>\s/.test(line)) return chalk.dim.italic(line);
      if (/^[-*]\s/.test(line)) return chalk.dim(line[0]) + line.slice(1);
      return line
        .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          (_, label, url) => `${chalk.cyan(label)} ${chalk.dim(`(${url})`)}`,
        );
    })
    .join('\n');
}
