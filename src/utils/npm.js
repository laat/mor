// @flow

import { spawn } from 'child_process';
import chalk from 'chalk';
import type { Package } from '../packages';
import { runSync as runS } from './run';
import prefixStream from './prefix-stream'

const colors = (function* colorsGenerator() {
  while(true) {
    yield chalk.red;
    yield chalk.green;
    yield chalk.blue;
    yield chalk.yellow;
    yield chalk.magenta;
    yield chalk.cyan;
  }
})();

function run(command, pkg, padLength) {
  return new Promise((resolve, reject) => {
    const child = spawn(`npm run ${command}`, { shell: true, cwd: pkg._root });
    const color = colors.next().value || (f => f);
    child.stdout.pipe(prefixStream(pkg.name, padLength, color)).pipe(process.stdout);
    child.stderr.pipe(prefixStream(pkg.name, padLength, color)).pipe(process.stderr);
    child.on('close', function (code) {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${pkg.name}: npm ${command} exited with code ${code}`))
      }
    })
    child.on('error', reject);
  })
}
export function runSync(command: string, pkg: Package) {
  runS(`npm run ${command}`, pkg._root);
}
export default {
  runSync,
  run,
}
