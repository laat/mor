#!/usr/bin/env node
// @flow
import 'loud-rejection/register';
import program from 'commander';
import core from 'mor-core';
import execa from 'execa';

program
  .usage('<script> [args...]')
  .description('Run npm script in the root workspace')
  .parse(process.argv);

(async () => {
  if (!program.rawArgs.slice(2).length) {
    program.outputHelp();
    process.exit(1);
  } else {
    const config = await core.config();
    const cwd = config.rootPath;
    if (config.rootPath == null) {
      console.log('Could not find root');
      process.exit(1);
    }
    const args = program.rawArgs.slice(3);
    const script = program.rawArgs[2];
    try {
      await execa('npm', ['run', script, ['--'], ...args], {
        cwd,
        stdio: 'inherit',
      });
    } catch (err) {
      console.log(err.message);
      process.exit(1);
    }
  }
})();
