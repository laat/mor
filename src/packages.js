// @flow
import type { Config } from './config';
import type { DAG } from './utils/dag';
import pify from 'pify';
import path from 'path';
import nativeFs from 'fs';
import findFiles from './utils/find-files';
import createDAG from './utils/dag';
import entries from './utils/entries';

const fs = pify(nativeFs);

export type Package = {
  _root: string,
  name?: string,
  version?: string,
  dependencies?: { [key: string]: string },
  devDependencies?: { [key: string]: string },
  optionalDependencies?: { [key: string]: string },
}

async function getPackageFiles(config) {
  const packageFiles = await findFiles('package.json', process.cwd(), config.ignore);
  return packageFiles.filter(fileName => fileName !== `${config._root}/package.json`);
}

async function readPackage(packageFile: string) {
  const content = await fs.readFile(packageFile);
  const json: Package = JSON.parse(content);
  json._root = path.dirname(packageFile);
  return json;
}

async function getPackages(config): Promise<Array<Package>> {
  const packageFiles: Array<string> = await getPackageFiles(config);
  return Promise.all(packageFiles.map(readPackage));
}

const mergedDependencies = (pkg: Package) => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.optionalDependencies,
});

export default async function getPackageGraph(config: Config, injectDag?: any) {
  const packages: Array<Package> = (await getPackages(config)).filter(pkg => pkg.name && pkg.version);
  const localPackageNames = packages.map(pkg => pkg.name);
  const dag = injectDag || createDAG();
  packages.forEach(pkg => {
    dag.addNode(pkg.name, pkg);
    entries(mergedDependencies(pkg))
      .filter(([name]) => localPackageNames.includes(name))
      .forEach(([name, version]) => {
        dag.addEdge(pkg.name, name, version);
      });
  })
  const toPackage = name => dag.node(name);
  return {
    all(): Array<Package> {
      return dag.nodes().map(toPackage);
    },
    dependencies(name): Array<Package> {
      return dag.from(name).map(toPackage);
    },
    predecessors(packages: Array<string>): Array<Package> {
      return dag.dfsNodes(packages, true).map(toPackage);
    },
    successors(packages: Array<string>): Array<Package> {
      return dag.dfsNodes(packages).map(toPackage);
    },
  }
}
