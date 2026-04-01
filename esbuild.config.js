import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/cli.cjs',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['better-sqlite3', 'sqlite-vec'],
  define: {
    'process.env.MOR_VERSION': JSON.stringify(pkg.version),
  },
});

chmodSync('dist/cli.cjs', 0o755);
