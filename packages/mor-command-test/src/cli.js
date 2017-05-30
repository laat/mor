#!/usr/bin/env node
// @flow
import 'loud-rejection/register';
import path from 'path';
import program from 'commander';
import processingUnits from 'processing-units';
import core from 'mor-core';
import testModule from './testModule';
import printError from './printError';
import timeSpan from 'time-span';
import prettyMs from 'pretty-ms';

program
  .option('-c, --concurrency <n>', 'number of processes to use', parseInt)
  .option('-o, --in-order', 'test modules in topological order')
  .option('-C, --handle-cycles', '')
  .parse(process.argv);

const end = timeSpan();
process.on('exit', () => {
  console.log(`✨  Done in ${prettyMs(end())}`);
});

(async function() {
  const mor = await core();
  const runOpts = {
    concurrency: program.concurrency || processingUnits(),
    handleCycles: program.handleCycles === true,
  };
  try {
    const errors = [];
    if (program.inOrder === true) {
      await mor.graph.processSafeOrder(testModule(errors), runOpts);
    } else {
      await mor.graph.processOrder(testModule(errors), runOpts);
    }
    errors.forEach(printError);
    if (errors.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.log({ err });
    process.exit(1);
  }
})();
