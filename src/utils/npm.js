// @flow

import path from 'path';
import pify from 'pify';
import execa from 'execa';
import nativeFs from 'fs-extra';
import logger from '../logger';
import type { Package } from '../packages';
import { runSync as runS } from './run';
import prefixStream from './prefix-stream';
import entries from '../utils/entries';
import isVerbose from '../utils/is-verbose';

const fs = pify(nativeFs);

async function exec(command: string, pkg: Package, padLength: number) {
  const child = execa.shell(command, { cwd: pkg._root });
  if (isVerbose()) {
    try {
      const result = await child;
      logger.info({
        name: pkg.name,
        command,
        ...result,
      });
    } catch (err) {
      logger.error({
        name: pkg.name,
        command,
        ...err,
      });
      throw err;
    }
  } else {
    child.stdout.pipe(prefixStream(pkg.name, padLength, pkg._color)).pipe(process.stdout);
    child.stderr.pipe(prefixStream(pkg.name, padLength, pkg._color)).pipe(process.stderr);
  }
  return child;
}

async function run(command: string, pkg: Package, padLength: number) {
  await exec(`npm run ${command}`, pkg, padLength);
}

function runSync(command: string, pkg: Package) {
  runS(`npm run ${command}`, pkg._root);
}

function getBinaries (pkg: Package) {
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
  const binPath = path.join(parent._root, 'node_modules/.bin');
  await fs.mkdirs(binPath);
  const relativeDepencency = path.relative(binPath, dependency._root);
  const relativeBins = getBinaries(dependency)
    .map(({ name, bin }) => ({ name, bin: path.join(relativeDepencency, bin) }));
  for (const { name, bin } of relativeBins) {
    await ln(bin, `${binPath}/${name}`, parent);
    // TODO: chmod+x binpath/name
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
  linkBin,
  exec,
};
