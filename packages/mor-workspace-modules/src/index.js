// @flow
'use strict';
import fs from 'fs';
import path from 'path';
import findUp from 'find-up';
import readPkg from 'read-pkg';
import readPkgUp from 'read-pkg-up';
import loadJsonFile from 'load-json-file';
import readModuleGlobs from './readModuleGlobs';

type Module = { pkg: Object, path: string };
type Workspaces = {
  root: Module,
  modules: () => Promise<Array<Module>>,
};

const findYarnRoot = async (cwd: string) => {
  const up = await readPkgUp({ cwd });
  if (up.pkg && up.pkg.workspaces instanceof Array) {
    return path.dirname(up.path);
  } else if (up.path == undefined) {
    return null;
  } else {
    return findYarnRoot(path.dirname(path.dirname(up.path)));
  }
};

const findLernaRoot = async (cwd: string) => {
  const lernafile = await findUp('lerna.json', { cwd });
  if (lernafile == null) {
    return null;
  }
  return path.dirname(lernafile);
};

const findRoot = async (cwd: string): Promise<?string> => {
  let deepestRoot;
  const roots = await Promise.all([findLernaRoot(cwd), findYarnRoot(cwd)]);
  roots.forEach(root => {
    if (root == null) {
    } else if (deepestRoot == null) {
      deepestRoot = root;
    } else if (deepestRoot.length < root.length) {
      deepestRoot = root;
    }
  });
  return deepestRoot;
};

const fileExist = async filename =>
  new Promise(resolve => {
    fs.lstat(filename, (err, stats) => {
      resolve(!err && stats.isFile());
    });
  });
const loadLernaModules = async (
  rootFolder: string
): Promise<?Array<Module>> => {
  const lernafile = path.join(rootFolder, 'lerna.json');
  if (!await fileExist(lernafile)) {
    return null;
  }
  const lernaCfg = await loadJsonFile(lernafile);
  return readModuleGlobs(lernaCfg.packages, rootFolder);
};

const loadYarnModules = async (rootFolder: string): Promise<?Array<Module>> => {
  const yarnfile = path.join(rootFolder, 'package.json');
  if (!await fileExist(yarnfile)) {
    return null;
  }
  const pkg = await loadJsonFile(yarnfile);
  if (pkg.workspaces instanceof Array) {
    return readModuleGlobs(pkg.workspaces, rootFolder);
  }
  return null;
};
const loadModules = async (rootFolder: string): Promise<Array<Module>> => {
  const modules = (await Promise.all([
    loadYarnModules(rootFolder),
    loadLernaModules(rootFolder),
  ])).filter(m => m != null);
  return modules[0] || [];
};

export default async (opts: { cwd: string } | null): Promise<Workspaces> => {
  const realCwd = opts != null && opts.cwd != null ? opts.cwd : process.cwd();
  const root = await findRoot(realCwd);
  if (root == null) {
    throw new Error('could not find root');
  }
  const modules = async () => loadModules(root);
  return {
    root: {
      pkg: await readPkg(root),
      path: path.join(root, 'package.json'),
    },
    modules,
  };
};
