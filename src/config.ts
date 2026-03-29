import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './types.js';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME ?? '', p.slice(1));
  }
  return p;
}

function getConfigDir(): string {
  if (process.env.MOR_HOME) {
    return expandHome(process.env.MOR_HOME);
  }
  return path.join(process.env.HOME ?? '', '.config', 'mor');
}

const DEFAULT_CONFIG: Config = {
  memoryDir: '~/.config/mor/memories',
  dbPath: '~/.config/mor/index.db',
};

export function loadConfig(): Config {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');

  fs.mkdirSync(configDir, { recursive: true });

  let config: Config;
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config = {
      ...DEFAULT_CONFIG,
      ...raw,
      ...(raw.embedding ? { embedding: raw.embedding } : {}),
      ...(raw.server ? { server: raw.server } : {}),
      ...(raw.serve ? { serve: raw.serve } : {}),
    };
  } else {
    config = { ...DEFAULT_CONFIG };
    config.memoryDir = path.join(configDir, 'memories');
    config.dbPath = path.join(configDir, 'index.db');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  // Resolve paths relative to configDir when they use ~
  config.memoryDir = expandHome(config.memoryDir);
  config.dbPath = expandHome(config.dbPath);

  // Ensure memory directory exists
  fs.mkdirSync(config.memoryDir, { recursive: true });

  return config;
}

export function isRemote(config: Config): boolean {
  return !!config.server?.url;
}
