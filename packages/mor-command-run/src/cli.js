// @flow
'use strict';
import 'loud-rejection/register';
import program from 'commander';
import processingUnits from 'processing-units';
import core from 'mor-core';
import morHelperFilter from 'mor-helper-filter';
import timeSpan from 'time-span';
import prettyMs from 'pretty-ms';
import supportsColor from 'supports-color';
import runCommand from './runCommand';

require('draftlog').into(console, supportsColor);

program
  .usage('[arguments...] -- <script>')
  .option('-g, --glob', 'match package names with glob')
  .option('-f, --files', 'packages containing files (absolute path)')
  .option('-s, --staged', 'staged packages')
  .option('-D, --dependencies', 'with dependencies')
  .option('-d, --dependents', 'with dependents')
  .option('-t, --transitive', 'with transitive')
  .option('-v, --verbose', 'verbose')
  .option(
    '-c, --concurrency <n>',
    `number of processes to use [default: ${processingUnits()}]`,
    parseInt
  )
  .option('-o, --in-order', 'test modules in reverse topological order')
  .option('-C, --handle-cycles', '');

program.on('--help', () => {
  console.log(`\
  The flag --staged does not work as a precommit hook, use --files`);
});

const commandIndex = process.argv.indexOf('--') >= 0
  ? process.argv.indexOf('--')
  : undefined;
const processArgv = process.argv.slice(0, commandIndex);
const rest = commandIndex ? process.argv.slice(commandIndex + 1) : [];
program.parse(processArgv);

const end = timeSpan();
process.on('exit', () => {
  console.log(`✨  Done in ${prettyMs(end())}`);
});

const logger = () => {
  if (program.verbose === true) {
    return console.log.bind(console);
  } else {
    // $FlowIgnore
    return console.draft.bind(console);
  }
};

(async function() {
  const mor = await core();
  const graph = await morHelperFilter(program.args, mor.graph, {
    transitive: program.transitive,
    dependents: program.dependents,
    dependencies: program.dependencies,
    glob: program.glob,
    staged: program.staged,
    files: program.files,
  });
  if (rest.length === 0) {
    console.error('Command required for example: "mor-run -- pwd"');
    process.exit(1);
  }
  const runOpts = {
    concurrency: program.concurrency || processingUnits(),
    handleCycles: program.handleCycles === true,
  };
  const commandRunner = runCommand(rest[0], logger);
  if (program.inOrder === true) {
    await graph.processSafeOrder(commandRunner, runOpts);
  } else {
    await graph.processOrder(commandRunner, runOpts);
  }
})();
