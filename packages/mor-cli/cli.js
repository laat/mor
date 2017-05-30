#!/usr/bin/env node
// @flow
'use strict';
const path = require('path');
const spawn = require('child_process').spawn;
const hasFlag = require('has-flag');
const core = require('mor-core').default;
const npmRunPath = require('npm-run-path');

function spawnCustomCli(rootPath, config, argv) {
  const cliPath = path.join(rootPath, config.cli);
  const wd = path.dirname(cliPath);
  try {
    const env = Object.assign(
      {},
      process.env,
      npmRunPath({ path: process.env.PATH || '', cwd: wd })
    );
    const proc = spawn(cliPath, argv.slice(2), { stdio: 'inherit' });
    proc.on('close', process.exit.bind(process));
  } catch (err) {
    if (err.code == 'ENOENT') {
      console.error('\n path does not exist \n', cliPath);
    } else if (err.code == 'EACCES') {
      console.error(
        '\n  %s not executable. try chmod or run with root\n',
        cliPath
      );
    }
    process.exit(1);
  }
}

(async function() {
  try {
    // long and confusing flag to make sure it will never have a colision with
    // other commands
    const noConfigFlag = '--no-mor-config';
    const noConfig = hasFlag(noConfigFlag);
    let argv = process.argv;
    if (noConfig) {
      argv.splice(argv.indexOf(noConfigFlag), 1);
    }

    const config = await core.config({ noConfig });
    const rootPath = config.rootPath;
    if (config.cli) {
      spawnCustomCli(rootPath, config, argv);
      return;
    } else {
      spawnCustomCli(__dirname, { cli: './commands/mor.js' }, argv);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
