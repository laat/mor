// @flow
'use strict';
import type { ModuleGraphNode } from 'mor-core';
import columnify from 'columnify';
import path from 'path';
import chalk from 'chalk';

export default function printColumns(modules: Array<ModuleGraphNode>) {
  const formattedPackages = modules.map(ws => ({
    name: ws.pkg.name || '',
    version: ws.pkg.version ? chalk.grey(ws.pkg.version) : '',
    private: ws.pkg.private ? `(${chalk.red('private')})` : '',
    path: path.dirname(ws.path),
  }));
  console.log(columnify(formattedPackages, { showHeaders: false }));
}
