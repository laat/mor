import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './operations.js';
import { migrateFromLegacyLayout } from './migrate-legacy.js';
import { expandHome } from './utils/path.js';

export function getConfigDir(): string {
  if (process.env.MOR_HOME) {
    return expandHome(process.env.MOR_HOME);
  }
  const base =
    process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? '', '.config');
  return path.join(base, 'mor');
}

export function getDataDir(): string {
  if (process.env.MOR_HOME) {
    return expandHome(process.env.MOR_HOME);
  }
  const base =
    process.env.XDG_DATA_HOME ??
    path.join(process.env.HOME ?? '', '.local', 'share');
  return path.join(base, 'mor');
}

export function getStateDir(): string {
  if (process.env.MOR_HOME) {
    return expandHome(process.env.MOR_HOME);
  }
  const base =
    process.env.XDG_STATE_HOME ??
    path.join(process.env.HOME ?? '', '.local', 'state');
  return path.join(base, 'mor');
}

function defaultNotesDir(): string {
  return path.join(getDataDir(), 'notes');
}

function defaultDbPath(): string {
  return path.join(getStateDir(), 'index.db');
}

const DEFAULT_CONFIG: Omit<Config, 'notesDir' | 'dbPath'> = {};

export function loadConfig(): Config {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');

  fs.mkdirSync(configDir, { recursive: true });

  // Auto-migrate from legacy ~/.config/mor flat layout (remove in next major)
  if (!process.env.MOR_HOME) {
    migrateFromLegacyLayout(configDir, getDataDir(), getStateDir());
  }

  let config: Config;
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Backwards compat: fall back to legacy `memoryDir` key if `notesDir` is unset
    const notesDir = raw.notesDir ?? raw.memoryDir ?? defaultNotesDir();
    const dbPath = raw.dbPath ?? defaultDbPath();
    config = {
      ...DEFAULT_CONFIG,
      ...raw,
      notesDir,
      dbPath,
      ...(raw.embedding ? { embedding: raw.embedding } : {}),
      ...(raw.server ? { server: raw.server } : {}),
      ...(raw.serve ? { serve: raw.serve } : {}),
    };
  } else {
    config = {
      ...DEFAULT_CONFIG,
      notesDir: defaultNotesDir(),
      dbPath: defaultDbPath(),
    };
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

  // Ensure directories exist
  fs.mkdirSync(config.notesDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

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
