// @flow
import pify from 'pify';
import path from 'path';
import nativeFs from 'fs';
import chalk from 'chalk';
import type { Config } from './config';
import findFiles from './utils/find-files';
import createDAG from './utils/dag';
import entries from './utils/entries';
import logger from './logger';

const fs = pify(nativeFs);

const colors = (function* colorsGenerator() {
  while (true) {
    yield chalk.red;
    yield chalk.green;
    yield chalk.blue;
    yield chalk.yellow;
    yield chalk.magenta;
    yield chalk.cyan;
  }
}());

export type Package = {
  _root: string,
  _color: Function,
  log: Function,
  error: Function,
  name?: string,
  bin?: { [key: string]: string } | string,
  version?: string,
  dependencies?: { [key: string]: string },
  devDependencies?: { [key: string]: string },
  optionalDependencies?: { [key: string]: string },
}

async function getPackageFiles(config) {
  const packageFiles = await findFiles('package.json', process.cwd(), config.ignore);
  return packageFiles.filter(fileName => fileName !== `${config._root}/package.json`);
}

export async function readPackage(packageFile: string) {
  const content = await fs.readFile(packageFile);
  const json: Package = JSON.parse(content);
  json._root = path.dirname(packageFile);
  json._color = colors.next().value || (id => id);
  json.log = (...args) => logger.info(`${json._color(json.name)} > ${args.join(' ')}`);
  json.error = (...args) => logger.error(`${json._color(json.name)}, ${args.join(' ')}`);
  return json;
}

async function getPackages(config): Promise<Array<Package>> {
  const packageFiles: Array<string> = await getPackageFiles(config);
  return Promise.all(packageFiles.map(readPackage));
}

export const mergedDependencies = (pkg: Package) => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.optionalDependencies,
});


export type PackageGraph = {
  all: () => Array<Package>,
  dependencies: (name: ?string) => Array<Package>,
}

export default async function getPackageGraph(
  config: Config,
  injectDag?: any
): Promise<PackageGraph> {
  const packages: Array<Package> = (await getPackages(config))
    .filter(pkg => pkg.name && pkg.version);
  const localPackageNames = packages.map(pkg => pkg.name);
  const dag = injectDag || createDAG();

  for (const pkg of packages) {
    if (pkg.name != null) {
      dag.addNode(pkg.name, pkg);
      for (const [name, version] of entries(mergedDependencies(pkg))) {
        if (pkg.name != null && localPackageNames.includes(name)) {
          dag.addEdge(pkg.name, name, version);
        }
      }
    }
  }
  const toPackage = name => dag.node(name);
  return {
    all(): Array<Package> {
      return dag.nodes().map(toPackage);
    },
    dependencies(name): Array<Package> {
      if (name == null) {
        return [];
      }
      return dag.from(name).map(toPackage);
    },
    predecessors(pkgs: Array<string>): Array<Package> {
      return dag.dfsNodes(pkgs, true).map(toPackage);
    },
    successors(pkgs: Array<string>): Array<Package> {
      return dag.dfsNodes(pkgs).map(toPackage);
    },
  };
}
