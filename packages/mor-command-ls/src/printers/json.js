// @flow
'use strict';
import type { ModuleGraphNode } from 'mor-core';

type ModuleInfo = { pkg: Object, path: string };
export default function(root: ModuleInfo, modules: Array<ModuleGraphNode>) {
  console.log(
    JSON.stringify({
      root,
      workspaces: modules.map(m => ({ pkg: m.pkg, path: m.path })),
    })
  );
}
