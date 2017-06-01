// @flow
import type { ModuleGraph } from 'mor-core';
import minimatch from 'minimatch';

export default (
  packageNames: Array<string>,
  graph: ModuleGraph,
  opts: {
    transitive?: boolean,
    dependents?: boolean,
    dependencies?: boolean,
    glob?: boolean,
  }
) => {
  const transitive = !!opts.transitive;
  const dependencies = !!opts.dependencies;
  const dependents = !!opts.dependents;
  const glob = !!opts.glob;

  let packages;
  if (glob) {
    const matches = name =>
      !glob || packageNames.some(pn => minimatch(name, pn));
    packages = graph.modules.filter(ws => matches(ws.name));
  } else {
    packages = packageNames.map(name => graph.getPackage(name));
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
  if (packageNames.length > 0) {
    toTest.push(...packages);
    return graph.filter(n => toTest.includes(n));
  }
  return graph;
};
