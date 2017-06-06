#!/usr/bin/env node
// @flow
/* eslint-disable no-console */
'use strict';
import 'loud-rejection/register';
import program from 'commander';
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
    .option('-s, --staged', 'staged packages')
    .option('-f, --files', 'packages with the given files (absolute paths)')
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

  The flag --staged does not work as a precommit hook, use --files
`);
  });

  program.parse(process.argv);

  const mor = await core();
  const graph = await morHelperFilter(program.args, mor.graph, {
    transitive: program.transitive,
    dependents: program.dependents,
    dependencies: program.dependencies,
    glob: program.glob,
    staged: program.staged,
    files: program.files,
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
