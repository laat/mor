import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getConfigDir,
  getDataDir,
  getStateDir,
  loadConfig,
  isRemote,
  type Env,
} from './config.js';

let testDir: string;
let env: Env;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-config-test-'));
  env = { MOR_HOME: testDir, HOME: process.env.HOME };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('creates default config on first run', () => {
    const config = loadConfig(env);
    expect(config.notesDir).toBe(path.join(testDir, 'notes'));
    expect(config.dbPath).toBe(path.join(testDir, 'index.db'));
    expect(fs.existsSync(path.join(testDir, 'config.json'))).toBe(true);
  });

  it('creates notes directory', () => {
    loadConfig(env);
    expect(fs.existsSync(path.join(testDir, 'notes'))).toBe(true);
  });

  it('writes valid JSON config file', () => {
    loadConfig(env);
    const raw = JSON.parse(
      fs.readFileSync(path.join(testDir, 'config.json'), 'utf-8'),
    );
    expect(raw.notesDir).toBeDefined();
    expect(raw.dbPath).toBeDefined();
  });

  it('reads existing config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        notesDir: path.join(testDir, 'custom-notes'),
        dbPath: path.join(testDir, 'custom.db'),
      }),
    );
    const config = loadConfig(env);
    expect(config.notesDir).toBe(path.join(testDir, 'custom-notes'));
    expect(config.dbPath).toBe(path.join(testDir, 'custom.db'));
  });

  it('falls back to legacy memoryDir key when notesDir is unset', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        memoryDir: path.join(testDir, 'legacy-memories'),
        dbPath: path.join(testDir, 'custom.db'),
      }),
    );
    const config = loadConfig(env);
    expect(config.notesDir).toBe(path.join(testDir, 'legacy-memories'));
  });

  it('prefers notesDir over legacy memoryDir when both are set', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        notesDir: path.join(testDir, 'new-notes'),
        memoryDir: path.join(testDir, 'old-memories'),
        dbPath: path.join(testDir, 'custom.db'),
      }),
    );
    const config = loadConfig(env);
    expect(config.notesDir).toBe(path.join(testDir, 'new-notes'));
  });

  it('expands ~ in paths', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        notesDir: '~/test-notes',
        dbPath: '~/test.db',
      }),
    );
    const config = loadConfig(env);
    const home = env.HOME ?? '';
    expect(config.notesDir).toBe(path.join(home, 'test-notes'));
    expect(config.dbPath).toBe(path.join(home, 'test.db'));
  });

  it('preserves embedding config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        embedding: {
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimensions: 1536,
        },
      }),
    );
    const config = loadConfig(env);
    expect(config.embedding?.provider).toBe('openai');
    expect(config.embedding?.model).toBe('text-embedding-3-small');
    expect(config.embedding?.dimensions).toBe(1536);
  });

  it('preserves server config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        server: { url: 'https://example.com', token: 'secret' },
      }),
    );
    const config = loadConfig(env);
    expect(config.server?.url).toBe('https://example.com');
    expect(config.server?.token).toBe('secret');
  });

  it('preserves serve config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        serve: { port: 8080, host: '0.0.0.0', token: 'abc', mcp: true },
      }),
    );
    const config = loadConfig(env);
    expect(config.serve?.port).toBe(8080);
    expect(config.serve?.host).toBe('0.0.0.0');
    expect(config.serve?.token).toBe('abc');
    expect(config.serve?.mcp).toBe(true);
  });

  it('preserves autosync config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ autosync: true }),
    );
    const config = loadConfig(env);
    expect(config.autosync).toBe(true);
  });

  it('preserves threshold config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ threshold: 0.5 }),
    );
    const config = loadConfig(env);
    expect(config.threshold).toBe(0.5);
  });

  it('uses MOR_HOME env var', () => {
    const config = loadConfig(env);
    expect(config.notesDir).toContain(testDir);
    expect(config.dbPath).toContain(testDir);
  });

  it('MOR_TOKEN overrides config file token', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        server: { url: 'https://example.com', token: 'old' },
        serve: { token: 'old' },
      }),
    );
    const config = loadConfig({ ...env, MOR_TOKEN: 'from-env' });
    expect(config.server?.token).toBe('from-env');
    expect(config.serve?.token).toBe('from-env');
  });
});

describe('isRemote', () => {
  it('returns false without server config', () => {
    const config = loadConfig(env);
    expect(isRemote(config)).toBe(false);
  });

  it('returns true with server url', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ server: { url: 'https://example.com' } }),
    );
    const config = loadConfig(env);
    expect(isRemote(config)).toBe(true);
  });

  it('returns false with empty server object', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ server: {} }),
    );
    const config = loadConfig(env);
    expect(isRemote(config)).toBe(false);
  });
});

describe('XDG directory helpers', () => {
  it('MOR_HOME makes all dirs the same (flat layout)', () => {
    expect(getConfigDir(env)).toBe(testDir);
    expect(getDataDir(env)).toBe(testDir);
    expect(getStateDir(env)).toBe(testDir);
  });

  it('uses XDG env vars when MOR_HOME is unset', () => {
    const xdgEnv: Env = {
      HOME: env.HOME,
      XDG_CONFIG_HOME: path.join(testDir, 'xdg-config'),
      XDG_DATA_HOME: path.join(testDir, 'xdg-data'),
      XDG_STATE_HOME: path.join(testDir, 'xdg-state'),
    };
    expect(getConfigDir(xdgEnv)).toBe(path.join(testDir, 'xdg-config', 'mor'));
    expect(getDataDir(xdgEnv)).toBe(path.join(testDir, 'xdg-data', 'mor'));
    expect(getStateDir(xdgEnv)).toBe(path.join(testDir, 'xdg-state', 'mor'));
  });

  it('falls back to ~/.config, ~/.local/share, ~/.local/state when no XDG vars', () => {
    const bareEnv: Env = { HOME: env.HOME };
    const home = env.HOME ?? '';
    expect(getConfigDir(bareEnv)).toBe(path.join(home, '.config', 'mor'));
    expect(getDataDir(bareEnv)).toBe(path.join(home, '.local', 'share', 'mor'));
    expect(getStateDir(bareEnv)).toBe(
      path.join(home, '.local', 'state', 'mor'),
    );
  });

  it('existing config without notesDir/dbPath uses XDG paths', () => {
    delete process.env.MOR_HOME;
    const xdgConfig = path.join(testDir, 'xdg-config');
    const xdgData = path.join(testDir, 'xdg-data');
    const xdgState = path.join(testDir, 'xdg-state');
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;
    process.env.XDG_STATE_HOME = xdgState;

    // Create config dir and a config.json that omits notesDir and dbPath
    fs.mkdirSync(path.join(xdgConfig, 'mor'), { recursive: true });
    fs.writeFileSync(
      path.join(xdgConfig, 'mor', 'config.json'),
      JSON.stringify({ autosync: true }),
    );

    try {
      const config = loadConfig();
      expect(config.notesDir).toBe(path.join(xdgData, 'mor', 'notes'));
      expect(config.dbPath).toBe(path.join(xdgState, 'mor', 'index.db'));
    } finally {
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.XDG_DATA_HOME;
      delete process.env.XDG_STATE_HOME;
      process.env.MOR_HOME = testDir;
    }
  });

  it('new install uses XDG data/state dirs for defaults', () => {
    const xdgEnv: Env = {
      HOME: env.HOME,
      XDG_CONFIG_HOME: path.join(testDir, 'xdg-config'),
      XDG_DATA_HOME: path.join(testDir, 'xdg-data'),
      XDG_STATE_HOME: path.join(testDir, 'xdg-state'),
    };
    const config = loadConfig(xdgEnv);
    expect(config.notesDir).toBe(
      path.join(testDir, 'xdg-data', 'mor', 'notes'),
    );
    expect(config.dbPath).toBe(
      path.join(testDir, 'xdg-state', 'mor', 'index.db'),
    );
    expect(
      fs.existsSync(path.join(testDir, 'xdg-config', 'mor', 'config.json')),
    ).toBe(true);
  });
});
