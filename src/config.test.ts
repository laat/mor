import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, isRemote } from './config.js';

let testDir: string;
let savedMorToken: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-config-test-'));
  process.env.MOR_HOME = testDir;
  savedMorToken = process.env.MOR_TOKEN;
  delete process.env.MOR_TOKEN;
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
  if (savedMorToken !== undefined) process.env.MOR_TOKEN = savedMorToken;
  else delete process.env.MOR_TOKEN;
});

describe('loadConfig', () => {
  it('creates default config on first run', () => {
    const config = loadConfig();
    expect(config.notesDir).toBe(path.join(testDir, 'notes'));
    expect(config.dbPath).toBe(path.join(testDir, 'index.db'));
    expect(fs.existsSync(path.join(testDir, 'config.json'))).toBe(true);
  });

  it('creates notes directory', () => {
    loadConfig();
    expect(fs.existsSync(path.join(testDir, 'notes'))).toBe(true);
  });

  it('writes valid JSON config file', () => {
    loadConfig();
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
    const config = loadConfig();
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
    const config = loadConfig();
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
    const config = loadConfig();
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
    const config = loadConfig();
    expect(config.notesDir).toBe(
      path.join(process.env.HOME ?? '', 'test-notes'),
    );
    expect(config.dbPath).toBe(path.join(process.env.HOME ?? '', 'test.db'));
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
    const config = loadConfig();
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
    const config = loadConfig();
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
    const config = loadConfig();
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
    const config = loadConfig();
    expect(config.autosync).toBe(true);
  });

  it('preserves threshold config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ threshold: 0.5 }),
    );
    const config = loadConfig();
    expect(config.threshold).toBe(0.5);
  });

  it('uses MOR_HOME env var', () => {
    const config = loadConfig();
    expect(config.notesDir).toContain(testDir);
    expect(config.dbPath).toContain(testDir);
  });
});

describe('isRemote', () => {
  it('returns false without server config', () => {
    const config = loadConfig();
    expect(isRemote(config)).toBe(false);
  });

  it('returns true with server url', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ server: { url: 'https://example.com' } }),
    );
    const config = loadConfig();
    expect(isRemote(config)).toBe(true);
  });

  it('returns false with empty server object', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({ server: {} }),
    );
    const config = loadConfig();
    expect(isRemote(config)).toBe(false);
  });
});
