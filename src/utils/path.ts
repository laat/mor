import path from 'node:path';

export function expandHome(p: string, home = process.env.HOME ?? ''): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(home, p.slice(1));
  }
  return p;
}
