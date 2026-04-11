import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './operations.js';
import { expandHome } from './utils/path.js';

export function getConfigDir(): string {
  if (process.env.MOR_HOME) {
    return expandHome(process.env.MOR_HOME);
  }
  return path.join(process.env.HOME ?? '', '.config', 'mor');
}

const DEFAULT_CONFIG: Config = {
  notesDir: '~/.config/mor/notes',
  dbPath: '~/.config/mor/index.db',
};

export function loadConfig(): Config {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');

  fs.mkdirSync(configDir, { recursive: true });

  let config: Config;
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Backwards compat: fall back to legacy `memoryDir` key if `notesDir` is unset
    const notesDir = raw.notesDir ?? raw.memoryDir ?? DEFAULT_CONFIG.notesDir;
    config = {
      ...DEFAULT_CONFIG,
      ...raw,
      notesDir,
      ...(raw.embedding ? { embedding: raw.embedding } : {}),
      ...(raw.server ? { server: raw.server } : {}),
      ...(raw.serve ? { serve: raw.serve } : {}),
    };
  } else {
    config = { ...DEFAULT_CONFIG };
    config.notesDir = path.join(configDir, 'notes');
    config.dbPath = path.join(configDir, 'index.db');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  // MOR_TOKEN env var overrides config file token (cli flag > env > config)
  if (process.env.MOR_TOKEN) {
    if (config.server) config.server.token = process.env.MOR_TOKEN;
    if (config.serve) config.serve.token = process.env.MOR_TOKEN;
  }

  // Resolve paths relative to configDir when they use ~
  config.notesDir = expandHome(config.notesDir);
  config.dbPath = expandHome(config.dbPath);

  // Ensure notes directory exists
  fs.mkdirSync(config.notesDir, { recursive: true });

  return config;
}

export function setServerUrl(url: string): void {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');
  const raw = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};
  raw.server = { ...raw.server, url };
  fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');
}

export function isRemote(config: Config): boolean {
  return !!config.server?.url;
}
