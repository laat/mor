/**
 * Tests for migrateFromLegacyLayout. Delete with migrate-legacy.ts in next major.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateFromLegacyLayout } from './migrate-legacy.js';

let tmpDir: string;
let configDir: string;
let dataDir: string;
let stateDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mor-migrate-test-'));
  configDir = path.join(tmpDir, 'config', 'mor');
  dataDir = path.join(tmpDir, 'share', 'mor');
  stateDir = path.join(tmpDir, 'state', 'mor');
  fs.mkdirSync(configDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupLegacy() {
  const notesDir = path.join(configDir, 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, 'test-note-abcd.md'), '# Hello');
  fs.writeFileSync(path.join(configDir, 'index.db'), 'db-content');
  fs.writeFileSync(path.join(configDir, 'index.db-wal'), 'wal');
  fs.writeFileSync(path.join(configDir, 'index.db-shm'), 'shm');
  fs.writeFileSync(path.join(configDir, 'credentials.json'), '{}');
  fs.writeFileSync(path.join(configDir, 'oauth.db'), 'oauth');
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      notesDir: path.join(configDir, 'notes'),
      dbPath: path.join(configDir, 'index.db'),
    }),
  );
}

describe('migrateFromLegacyLayout', () => {
  it('moves notes to data dir', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(
      fs.existsSync(path.join(dataDir, 'notes', 'test-note-abcd.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'notes'))).toBe(false);
  });

  it('moves index.db and WAL files to state dir', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(fs.readFileSync(path.join(stateDir, 'index.db'), 'utf-8')).toBe(
      'db-content',
    );
    expect(fs.readFileSync(path.join(stateDir, 'index.db-wal'), 'utf-8')).toBe(
      'wal',
    );
    expect(fs.readFileSync(path.join(stateDir, 'index.db-shm'), 'utf-8')).toBe(
      'shm',
    );
    expect(fs.existsSync(path.join(configDir, 'index.db'))).toBe(false);
  });

  it('moves credentials.json to state dir', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(fs.existsSync(path.join(stateDir, 'credentials.json'))).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'credentials.json'))).toBe(false);
  });

  it('moves oauth.db to state dir', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(fs.readFileSync(path.join(stateDir, 'oauth.db'), 'utf-8')).toBe(
      'oauth',
    );
    expect(fs.existsSync(path.join(configDir, 'oauth.db'))).toBe(false);
  });

  it('updates config.json paths', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    const raw = JSON.parse(
      fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8'),
    );
    expect(raw.notesDir).toBe(path.join(dataDir, 'notes'));
    expect(raw.dbPath).toBe(path.join(stateDir, 'index.db'));
  });

  it('leaves config.json in config dir', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(fs.existsSync(path.join(configDir, 'config.json'))).toBe(true);
  });

  it('skips migration when new notes dir already exists', () => {
    setupLegacy();
    fs.mkdirSync(path.join(dataDir, 'notes'), { recursive: true });
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    // Legacy files should still be in place
    expect(
      fs.existsSync(path.join(configDir, 'notes', 'test-note-abcd.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'index.db'))).toBe(true);
  });

  it('skips migration when legacy notes dir does not exist', () => {
    // No legacy setup — just a config.json
    fs.writeFileSync(path.join(configDir, 'config.json'), '{}');
    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(fs.existsSync(dataDir)).toBe(false);
  });

  it('skips when configDir equals dataDir (MOR_HOME flat layout)', () => {
    setupLegacy();
    migrateFromLegacyLayout(configDir, configDir, configDir);

    // Nothing moved — files still in configDir
    expect(
      fs.existsSync(path.join(configDir, 'notes', 'test-note-abcd.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'index.db'))).toBe(true);
  });

  it('handles missing optional files gracefully', () => {
    // Only create notes dir, no db or credentials
    fs.mkdirSync(path.join(configDir, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'notes', 'a.md'), 'hi');

    migrateFromLegacyLayout(configDir, dataDir, stateDir);

    expect(fs.existsSync(path.join(dataDir, 'notes', 'a.md'))).toBe(true);
  });

  it('falls back to copy+remove when renameSync throws EXDEV', () => {
    // Simulate EXDEV (cross-device rename) by making renameSync throw
    // for calls within this test. This exercises the fallback path that
    // uses copyFileSync/cpSync + unlinkSync/rmSync.
    setupLegacy();

    const renameSpy = vi
      .spyOn(fs, 'renameSync')
      .mockImplementation((_src, _dest) => {
        const err: NodeJS.ErrnoException = new Error(
          'EXDEV: cross-device link not permitted',
        );
        err.code = 'EXDEV';
        throw err;
      });

    try {
      migrateFromLegacyLayout(configDir, dataDir, stateDir);
    } finally {
      renameSpy.mockRestore();
    }

    // Notes directory moved via cpSync fallback
    expect(
      fs.existsSync(path.join(dataDir, 'notes', 'test-note-abcd.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'notes'))).toBe(false);

    // Database files moved via copyFileSync fallback
    expect(fs.readFileSync(path.join(stateDir, 'index.db'), 'utf-8')).toBe(
      'db-content',
    );
    expect(fs.existsSync(path.join(configDir, 'index.db'))).toBe(false);

    // Credentials moved via copyFileSync fallback
    expect(fs.existsSync(path.join(stateDir, 'credentials.json'))).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'credentials.json'))).toBe(false);
  });
});
