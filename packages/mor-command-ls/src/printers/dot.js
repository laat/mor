// @flow
'use strict';
import type { ModuleGraph } from 'mor-core';

const quote = name => `"${name || 'undefined'}"`;

export default (graph: ModuleGraph) => {
  const out = ['digraph deps {'];
  graph.modules.forEach(m => {
    graph.dependencies(m).forEach(dep => {
      out.push(`  ${quote(m.name)} -> ${quote(dep.name)};`);
    });
  });
  out.push('}\n');
  console.log(out.join('\n'));
};
