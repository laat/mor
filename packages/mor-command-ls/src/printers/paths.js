// @flow
'use strict';
import type { ModuleGraphNode } from 'mor-core';
import path from 'path';

export default function printPaths(modules: Array<ModuleGraphNode>) {
  modules.forEach(ws => {
    console.log(path.dirname(ws.path));
  });
}
