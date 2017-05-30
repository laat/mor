#!/usr/bin/env node
'use strict';
const core = require('mor-core');
const program = require('commander');

program.option('--no-config', 'run without configuration');

// alias broken
// https://github.com/tj/commander.js/issues/419
program
  .command('root', 'root folder')
  .command('ls', 'list packages managed')
  .command('test', 'test all packages')
  .parse(process.argv);
