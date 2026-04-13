/**
 * One-time migration from the legacy flat ~/.config/mor layout to XDG dirs.
 * This entire file can be deleted in the next major version.
 */
import fs from 'node:fs';
import path from 'node:path';

function moveFile(src: string, destDir: string): void {
  const dest = path.join(destDir, path.basename(src));
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.mkdirSync(destDir, { recursive: true });
    try {
      fs.renameSync(src, dest);
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } else {
        throw err;
      }
    }
  }
}

function moveDir(src: string, dest: string): void {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(src, dest);
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        fs.cpSync(src, dest, { recursive: true });
        fs.rmSync(src, { recursive: true });
      } else {
        throw err;
      }
    }
  }
}

/**
 * Migrate from legacy ~/.config/mor flat layout to XDG-split directories.
 *
 * Triggered when:
 *   - MOR_HOME is NOT set (caller checks this)
 *   - Legacy notes dir exists at configDir/notes
 *   - New data dir notes does NOT yet exist
 *
 * Moves:
 *   configDir/notes/        → dataDir/notes/
 *   configDir/index.db*     → stateDir/index.db*
 *   configDir/credentials.json → stateDir/credentials.json
 *   configDir/oauth.db*     → stateDir/oauth.db*
 *
 * Updates notesDir/dbPath in config.json if they point to old paths.
 */
export function migrateFromLegacyLayout(
  configDir: string,
  dataDir: string,
  stateDir: string,
): void {
  // Only migrate if configDir != dataDir (i.e. not a MOR_HOME flat layout)
  if (configDir === dataDir) return;

  const legacyNotes = path.join(configDir, 'notes');
  const newNotes = path.join(dataDir, 'notes');

  // Guard: only migrate if old layout exists and new layout doesn't
  if (!fs.existsSync(legacyNotes) || fs.existsSync(newNotes)) return;

  // Move notes directory
  moveDir(legacyNotes, newNotes);

  // Move database files (index.db, index.db-wal, index.db-shm)
  for (const suffix of ['', '-wal', '-shm']) {
    moveFile(path.join(configDir, `index.db${suffix}`), stateDir);
  }

  // Move credential/OAuth files
  moveFile(path.join(configDir, 'credentials.json'), stateDir);
  for (const suffix of ['', '-wal', '-shm']) {
    moveFile(path.join(configDir, `oauth.db${suffix}`), stateDir);
  }

  // Update config.json paths if they reference old locations
  const configPath = path.join(configDir, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      let changed = false;

      if (raw.notesDir === path.join(configDir, 'notes')) {
        raw.notesDir = newNotes;
        changed = true;
      }

      const oldDb = path.join(configDir, 'index.db');
      if (raw.dbPath === oldDb) {
        raw.dbPath = path.join(stateDir, 'index.db');
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');
      }
    } catch {
      // Non-fatal: config.json may be malformed; loadConfig will handle it
    }
  }
}
