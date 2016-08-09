/* eslint-disable no-console */
// @flow
import path from 'path';
import nativeFs from 'fs';
import { execSync } from 'child_process';
import pify from 'pify';
import sane from 'sane';
import findFiles from './utils/find-files';
import { runSync } from './run';

const fs = pify(nativeFs);

function hasWatchman() {
  try {
    execSync('watchman version', { silent: true, stdio: [] });
    return true;
  } catch (err) {
    return false;
  }
}

async function loadWatches() {
  const watchFiles = await findFiles('.watch', process.cwd(), ['**/node_modules', '.git']);
  const files = await Promise.all(watchFiles.map(async file => {
    const data = await fs.readFile(file);
    return { wd: path.dirname(file), data: JSON.parse(data) };
  }));
  return files;
}

const watch = (wd, watchman) => (watchDefinition) => {
  const watcher = sane(wd, {
    glob: watchDefinition.patterns,
    watchman,
  });

  function exec(file) {
    try {
      let command;
      if (watchDefinition.appendFiles) {
        command = `${watchDefinition.command} ${file}`;
      } else {
        command = watchDefinition.command;
      }
      console.log(`\n> Watch triggered at: ${wd}\n> Executing ${command}`);
      runSync(command, wd);
    } catch (err) {
      console.error(err);
    }
  }
  watcher.on('change', exec);
  watcher.on('add', exec);
  watcher.on('delete', exec);
};

const setupWatches = async (phase) => {
  const definitions = await loadWatches();
  const watchman = await hasWatchman();
  definitions.forEach(({ wd, data: phaseData }) => {
    if (!phaseData[phase]) {
      return;
    }
    const phaseWatches = phaseData[phase];
    phaseWatches.forEach(watch(wd, watchman));
  });
};

setupWatches('build').catch(err => console.error(err));

// hasWatchman();
// loadWatches().then(f => console.log(f)).catch(e => console.error(e))
