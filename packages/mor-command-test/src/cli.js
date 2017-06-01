#!/usr/bin/env node
// @flow
import 'loud-rejection/register';
import program from 'commander';
import processingUnits from 'processing-units';
import core from 'mor-core';
import morHelperFilter from 'mor-helper-filter';
import testModule from './testModule';
import printError from './printError';
import timeSpan from 'time-span';
import prettyMs from 'pretty-ms';

program
  .usage('[packages...]')
  .option('-g, --glob', 'match package names with glob')
  .option('-D, --dependencies', 'with dependencies')
  .option('-d, --dependents', 'with dependents')
  .option('-t, --transitive', 'with transitive')
  .option(
    '-c, --concurrency <n>',
    `number of processes to use [default: ${processingUnits()}]`,
    parseInt
  )
  .option('-o, --in-order', 'test modules in reverse topological order')
  .option('-C, --handle-cycles', '')
  .parse(process.argv);

const end = timeSpan();
process.on('exit', () => {
  console.log(`✨  Done in ${prettyMs(end())}`);
});

(async function() {
  const mor = await core();
  const graph = morHelperFilter(program.args, mor.graph, {
    transitive: program.transitive,
    dependents: program.dependents,
    dependencies: program.dependencies,
    glob: program.glob,
  });
  try {
    const errors = [];
    const runOpts = {
      concurrency: program.concurrency || processingUnits(),
      handleCycles: program.handleCycles === true,
    };
    if (program.inOrder === true) {
      await graph.processSafeOrder(testModule(errors), runOpts);
    } else {
      await graph.processOrder(testModule(errors), runOpts);
    }
    errors.forEach(printError);
    if (errors.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
})();
