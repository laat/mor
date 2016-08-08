import findFiles from './utils/find-files';
import path from 'path';
import nativeFs from 'fs';
import pify from 'pify';
import sane from 'sane';
import { runSync } from './run';
import { execSync } from 'child_process';
const fs = pify(nativeFs);

function hasWatchman() {
  try {
    execSync('watchman version', { silent: true, stdio: []});
    return true;
  } catch (err) {
    console.log(err);
    return false;
  }
}

async function loadWatches() {
  const watchFiles = await findFiles('.watch', process.cwd(), ['**/node_modules', '.git']);
  const files = await Promise.all(watchFiles.map(async file => {
    const data = await fs.readFile(file);
    return { path: path.dirname(file), data: JSON.parse(data) };
  }));
  return files;
}

async function setupWatches(phase) {
  const definitions = await loadWatches();
  const watchman = await hasWatchman();
  console.log(definitions)
  definitions.forEach(({ path, data: phaseData })=> {
    if(!phaseData[phase]) {
      return;
    }
    console.log('hello!')
    const phaseWatches = phaseData[phase];
    phaseWatches.forEach(data => {
      console.log(data);
      const watcher = sane(path, {
        glob: data.patterns,
        watchman,
      });

      function exec(file) {
        try {
          let command;
          if (data.appendFiles) {
            command = `${data.command} ${file}`;
          } else {
            command = data.command;
          }
          console.log(command);
          runSync(command, path);
        } catch (err) {
          console.error(err);
        }
      }
      watcher.on('change', exec);
      watcher.on('add', exec);
      watcher.on('delete', exec);
    })
  })
}

setupWatches('build').catch(err => console.error(err));

// hasWatchman();
// loadWatches().then(f => console.log(f)).catch(e => console.error(e))
