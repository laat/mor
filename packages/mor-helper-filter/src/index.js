// @flow
import type { ModuleGraph } from 'mor-core';
import path from 'path';
import minimatch from 'minimatch';
import stagedGitFiles from 'staged-git-files';
import gitRootpath from './git-rootpath';

const getStaged = () =>
  new Promise((resolve, reject) => {
    stagedGitFiles((err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });

const getStagedFullPath = async () => {
  const staged = await getStaged();
  const root = await gitRootpath();
  return staged.map(stg =>
    Object.assign({}, stg, {
      filename: path.join(root, stg.filename),
    })
  );
};

export default async (
  packageNames: Array<string>,
  graph: ModuleGraph,
  opts: {
    transitive?: boolean,
    dependents?: boolean,
    dependencies?: boolean,
    staged?: boolean,
    files?: boolean,
    glob?: boolean,
  }
) => {
  const transitive = !!opts.transitive;
  const dependencies = !!opts.dependencies;
  const dependents = !!opts.dependents;
  const staged = !!opts.staged;
  const files = !!opts.files;
  const glob = !!opts.glob;

  let packages;
  if (glob) {
    const matches = name => packageNames.some(pn => minimatch(name, pn));
    packages = graph.modules.filter(ws => matches(ws.name));
  } else if (files) {
    const matches = pkgPath =>
      packageNames.some(filename => filename.startsWith(pkgPath));
    packages = graph.modules.filter(ws => matches(path.dirname(ws.path)));
  } else if (packageNames.length > 0) {
    packages = packageNames.map(name => graph.getPackage(name));
  } else {
    packages = graph.modules;
  }
  if (staged) {
    const staged = await getStagedFullPath();
    packages = packages.filter(pkg =>
      staged.some(stg => stg.filename.startsWith(path.dirname(pkg.path)))
    );
  }
  const toTest = [];
  if (dependents) {
    packages.forEach(pkg => {
      toTest.push(...graph.dependents(pkg, { transitive }));
    });
  }
  if (dependencies) {
    packages.forEach(pkg => {
      toTest.push(...graph.dependencies(pkg, { transitive }));
    });
  }
  toTest.push(...packages);
  return graph.filter(n => toTest.includes(n));
};
