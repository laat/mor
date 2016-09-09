// @flow
/* eslint-disable no-console */
import 'source-map-support/register';
import 'any-observable/register/rxjs-all';
import fs from 'fs';
import Observable from 'any-observable';
import streamToObservable from 'stream-to-observable';
import Listr from 'listr';
import getPackages, { mergedDependencies, readPackage } from '../packages';
import getConfig from '../config';
import isVerbose from '../utils/is-verbose';
import entries from '../utils/entries';
import npm from '../utils/npm';
import limiter from '../utils/limiter';
import logger from '../logger';

const isStream = obj => obj !== null && typeof obj === 'object' && typeof obj.pipe === 'function';

const len = (string: ?string) => (string != null ? string.length : 0);
const maxNameLength = packages => Math.max.apply(null, packages.all().map(pkg => len(pkg.name)));
const limit = limiter(4);

async function runTasks(tasks = []) {
  for (const task of tasks) {
    console.log(`> ${task.title}`);
    let result: any = task.task();
    if (isStream(result)) {
      result = streamToObservable(result);
    }
    if (result instanceof Observable) {
      result = new Promise((resolve, reject) => {
        result.subscribe({
          error: reject,
          complete: resolve,
        });
      });
    }
    if (result instanceof Promise) {
      await result;
    }
  }
}

async function linkRootBin(packages, config) {
  const morDependencies = [];
  for (const [name] of entries(mergedDependencies(config.package))) {
    const morDependency = await readPackage(`${config._root}/node_modules/${name}/package.json`);
    morDependencies.push(morDependency);
  }

  const promises = [];
  for (const pkg of packages.all()) {
    for (const dep of morDependencies) {
      promises.push(limit.run(() => npm.linkBin(pkg, dep, { overwrite: false })));
    }
  }
  await Promise.all(promises);
}

function link(packages) {
  const promises = [];
  for (const pkg of packages.all()) {
    if (pkg.name != null) {
      for (const dep of packages.dependencies(pkg.name)) {
        promises.push(limit.run(() => npm.link(pkg, dep)));
      }
    }
  }
  return Promise.all(promises);
}

function install(packages) {
  const maxLength = maxNameLength(packages);
  return new Observable((observer) => {
    const promises = [];
    const installing = [];
    for (const pkg of packages.all()) {
      const externalDependencies = entries(mergedDependencies(pkg))
      .filter(([name]) => !packages.dependencies(pkg.name).some(dep => dep.name === name))
      .filter(([name]) => {
        // already installed
        try {
          fs.statSync(`${pkg._root}/node_modules/${name}`);
          return false;
        } catch (err) {
          return true;
        }
      })
      .map(([name, version]) => `${name}@${version}`)
      .join(' ');


      promises.push(limit.run(async () => {
        installing.push(pkg.name);
        observer.next(installing.join(', '));
        if (pkg.scripts && pkg.scripts.preinstall) {
          await npm.run('preinstall', pkg, maxLength);
        }
        if (externalDependencies !== '') {
          await npm.exec(`npm install ${externalDependencies}`, pkg, maxLength);
        }
        if (pkg.scripts && pkg.scripts.postinstall) {
          await npm.run('postinstall', pkg, maxLength);
        }
        if (pkg.scripts && pkg.scripts.prepublish) {
          await npm.run('prepublish', pkg, maxLength);
        }
        installing.splice(installing.indexOf(pkg.name), 1);
        observer.next(installing.join(', '));
      }));
    }

    Promise.all(promises)
      .then(() => observer.complete())
      .catch(err => observer.error(err));
  });
}

async function bootstrap() {
  const config = await getConfig();
  const packages = await getPackages(config);
  const tasks = [{
    title: 'link root bin dependencies',
    task: () => linkRootBin(packages, config),
  }, {
    title: 'link local dependencies',
    task: () => link(packages),
  }, {
    title: 'npm install packages',
    task: () => install(packages),
  }, {
    title: 'relink local dependencies',
    task: () => link(packages),
  }];
  if (!isVerbose()) {
    const listr = new Listr(tasks);
    await listr.run();
  } else {
    await runTasks(tasks);
  }
}

bootstrap().catch(() => logger.dumpLogs());
