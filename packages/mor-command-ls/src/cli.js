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
import morHelperFilter from 'mor-helper-filter';

import printNames from './printers/names';
import printPaths from './printers/paths';
import printColumns from './printers/column';
import printJson from './printers/json';
import printDot from './printers/dot';

(async function main() {
  program
    .usage('[packages...]')
    .option('-g, --glob', 'match packages with glob')
    .option('-D, --dependencies', 'with dependencies')
    .option('-d, --dependents', 'with dependents')
    .option('-t, --transitive', 'with transitive')
    .option(
      '-f, --format <format>',
      'Output format',
      /^(j|json|c|column|p|path|n|name|d|dot)$/i,
      'column'
    );

  program.on('--help', () => {
    console.log(`\
  Formats:
    c, column (default)
    p, path
    j, json
    n, name
    d, dot

  Examples:
    mor ls --format dot | dot -Tsvg > dependencies.svg
`);
  });

  program.parse(process.argv);

  const mor = await core();
  const graph = morHelperFilter(program.args, mor.graph, {
    transitive: program.transitive,
    dependents: program.dependents,
    dependencies: program.dependencies,
    glob: program.glob,
  });
  switch (program.format) {
    case 'p':
    case 'path':
      printPaths(graph.modules);
      break;
    case 'n':
    case 'name':
      printNames(graph.modules);
      break;
    case 'j':
    case 'json':
      printJson(mor.root, graph.modules);
      break;
    case 'd':
    case 'dot':
      printDot(graph);
      break;
    case 'c':
    case 'column':
    default:
      printColumns(graph.modules);
      break;
  }
})();
