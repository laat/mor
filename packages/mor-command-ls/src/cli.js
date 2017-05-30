#!/usr/bin/env node
// @flow
/* eslint-disable no-console */
'use strict';
import 'loud-rejection/register';
import path from 'path';
import program from 'commander';
import chalk from 'chalk';
import columnify from 'columnify';
import core from 'mor-core';

function printPaths(mor) {
  mor.workspaces.forEach(ws => {
    console.log(path.dirname(ws.path));
  });
}

function printColumns(mor) {
  const formattedPackages = mor.workspaces.map(ws => ({
    name: ws.pkg.name || '',
    version: ws.pkg.version ? chalk.grey(ws.pkg.version) : '',
    private: ws.pkg.private ? `(${chalk.red('private')})` : '',
    path: path.dirname(ws.path),
  }));
  console.log(columnify(formattedPackages, { showHeaders: false }));
}

function printJson(mor) {
  console.log(JSON.stringify({ root: mor.root, workspaces: mor.workspaces }));
}

(async function main() {
  program
    .option('-p, --paths', 'return paths')
    .option('-j, --json', 'return json')
    .parse(process.argv);

  const mor = await core();
  if (program.paths) {
    printPaths(mor);
  } else if (program.json) {
    printJson(mor);
  } else {
    printColumns(mor);
  }
})();
