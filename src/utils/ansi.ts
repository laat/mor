import chalk from 'chalk';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// eslint-disable-next-line no-control-regex
export const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
export const ANSI_START_RE = /^\x1b\[[0-9;]*[A-Za-z]/;

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

const terminalMarked = new Marked(
  markedTerminal({
    firstHeading: chalk.bold.green,
    heading: chalk.bold.green,
    codespan: chalk.yellow,
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    link: chalk.cyan,
    href: chalk.dim,
    showSectionPrefix: false,
    tab: 2,
  }),
);

/**
 * Render markdown to styled terminal output via marked + marked-terminal.
 */
export function colorizeMarkdown(text: string): string {
  return (terminalMarked.parse(text) as string).replace(/\n+$/, '');
}
