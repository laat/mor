import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './operations.js';
import { migrateFromLegacyLayout } from './migrate-legacy.js';
import { expandHome } from './utils/path.js';

export type Env = Record<string, string | undefined>;

export function getConfigDir(env: Env = process.env): string {
  if (env.MOR_HOME) {
    return expandHome(env.MOR_HOME, env.HOME);
  }
  const base = env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? '', '.config');
  return path.join(base, 'mor');
}

export function getDataDir(env: Env = process.env): string {
  if (env.MOR_HOME) {
    return expandHome(env.MOR_HOME, env.HOME);
  }
  const base =
    env.XDG_DATA_HOME ?? path.join(env.HOME ?? '', '.local', 'share');
  return path.join(base, 'mor');
}

export function getStateDir(env: Env = process.env): string {
  if (env.MOR_HOME) {
    return expandHome(env.MOR_HOME, env.HOME);
  }
  const base =
    env.XDG_STATE_HOME ?? path.join(env.HOME ?? '', '.local', 'state');
  return path.join(base, 'mor');
}

function defaultNotesDir(env: Env): string {
  return path.join(getDataDir(env), 'notes');
}

function defaultDbPath(env: Env): string {
  return path.join(getStateDir(env), 'index.db');
}

const DEFAULT_CONFIG: Omit<Config, 'notesDir' | 'dbPath'> = {};

export function loadConfig(env: Env = process.env): Config {
  const configDir = getConfigDir(env);
  const configPath = path.join(configDir, 'config.json');

  fs.mkdirSync(configDir, { recursive: true });

  // Auto-migrate from legacy ~/.config/mor flat layout (remove in next major)
  if (!env.MOR_HOME) {
    migrateFromLegacyLayout(configDir, getDataDir(env), getStateDir(env));
  }

  let config: Config;
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Backwards compat: fall back to legacy `memoryDir` key if `notesDir` is unset
    const notesDir = raw.notesDir ?? raw.memoryDir ?? defaultNotesDir(env);
    const dbPath = raw.dbPath ?? defaultDbPath(env);
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
      notesDir: defaultNotesDir(env),
      dbPath: defaultDbPath(env),
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  // MOR_TOKEN env var overrides config file token (cli flag > env > config)
  if (env.MOR_TOKEN) {
    if (config.server) config.server.token = env.MOR_TOKEN;
    if (config.serve) config.serve.token = env.MOR_TOKEN;
  }

  // Resolve paths relative to configDir when they use ~
  config.notesDir = expandHome(config.notesDir, env.HOME);
  config.dbPath = expandHome(config.dbPath, env.HOME);

  // Ensure directories exist
  fs.mkdirSync(config.notesDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  return config;
}

export function setServerUrl(url: string, env: Env = process.env): void {
  const configDir = getConfigDir(env);
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
