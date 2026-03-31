import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, isRemote } from './config.js';

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-config-test-'));
  process.env.MOR_HOME = testDir;
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.MOR_HOME;
});

describe('loadConfig', () => {
  it('creates default config on first run', () => {
    const config = loadConfig();
    expect(config.memoryDir).toBe(path.join(testDir, 'memories'));
    expect(config.dbPath).toBe(path.join(testDir, 'index.db'));
    expect(fs.existsSync(path.join(testDir, 'config.json'))).toBe(true);
  });

  it('creates memory directory', () => {
    loadConfig();
    expect(fs.existsSync(path.join(testDir, 'memories'))).toBe(true);
  });

  it('writes valid JSON config file', () => {
    loadConfig();
    const raw = JSON.parse(
      fs.readFileSync(path.join(testDir, 'config.json'), 'utf-8'),
    );
    expect(raw.memoryDir).toBeDefined();
    expect(raw.dbPath).toBeDefined();
  });

  it('reads existing config', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        memoryDir: path.join(testDir, 'custom-memories'),
        dbPath: path.join(testDir, 'custom.db'),
      }),
    );
    const config = loadConfig();
    expect(config.memoryDir).toBe(path.join(testDir, 'custom-memories'));
    expect(config.dbPath).toBe(path.join(testDir, 'custom.db'));
  });

  it('expands ~ in paths', () => {
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify({
        memoryDir: '~/test-memories',
        dbPath: '~/test.db',
      }),
    );
    const config = loadConfig();
    expect(config.memoryDir).toBe(
      path.join(process.env.HOME ?? '', 'test-memories'),
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
    expect(config.memoryDir).toContain(testDir);
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
