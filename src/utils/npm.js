// @flow

import { spawn } from 'child_process';
import chalk from 'chalk';
import path from 'path';
import pify from 'pify';
import nativeFs from 'fs-extra';
import type { Package } from '../packages';
import { runSync as runS } from './run';
import prefixStream from './prefix-stream'
import entries from '../utils/entries';

const fs = pify(nativeFs);

export function exec(command: string, pkg: Package, padLength: number) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd: pkg._root });
    child.stdout.pipe(prefixStream(pkg.name, padLength, pkg._color)).pipe(process.stdout);
    child.stderr.pipe(prefixStream(pkg.name, padLength, pkg._color)).pipe(process.stderr);
    child.on('close', function (code) {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${pkg.name || 'undefined'}: npm ${command} exited with code ${code}`))
      }
    })
    child.on('error', reject);
  })
}

export async function run(command: string, pkg: Package, padLength: number) {
  await exec(`npm run ${command}`, pkg, padLength);
}

export function runSync(command: string, pkg: Package) {
  runS(`npm run ${command}`, pkg._root);
}

export function getBinaries (pkg: Package) {
  var name = pkg.name || '';
  var bin = pkg.bin;
  if (bin == null) {
    return [];
  } else if (typeof bin === 'string') {
    return [{ name, bin }];
  } else {
    const bins = [];
    for (const [key, value] of entries(bin)) {
      bins.push({name: key, bin: value});
    }
    return bins;
  }
}

async function ln(source: string, destination: string, parent: Package) {
  try {
    await fs.remove(destination);
  } catch (err) {
    parent.log(`rm -rf ${destination}`);
    parent.error('failed to remove', destination);
  }
  parent.log(`ln -s ${source} ${destination}`);
  await fs.symlink(source, destination);
}

async function linkBin(parent: Package, dependency: Package) {
  if (!dependency.name) {
    return;
  }
  const depName = dependency.name;
  const binPath = path.join(parent._root, 'node_modules/.bin');
  await fs.mkdirs(binPath);
  const relativeDepencency = path.relative(binPath, dependency._root);
  const relativeBins = getBinaries(dependency)
    .map(({name, bin}) => ({name, bin: `../${path.join(depName, bin)}`}));
  for (const {name, bin} of relativeBins) {
    await ln(bin, `${binPath}/${name}`, parent)
  }
}

async function link(parent: Package, dependency: Package) {
  if (!dependency.name) {
    return;
  }
  const depName = dependency.name;
  const nodeModules = path.join(parent._root, 'node_modules');
  await fs.mkdirs(nodeModules);
  const relativeDepencency = path.relative(nodeModules, dependency._root);
  await ln(relativeDepencency, `${nodeModules}/${depName}`, parent);
  await linkBin(parent, dependency);
}
export default {
  runSync,
  run,
  link,
  exec,
}
