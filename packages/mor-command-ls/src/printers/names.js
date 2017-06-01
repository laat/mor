// @flow
'use strict';
import type { ModuleGraphNode } from 'mor-core';

export default function printNames(modules: Array<ModuleGraphNode>) {
  modules.forEach(ws => console.log(ws.name));
}
