// @flow
/* eslint-disable no-console */
'use strict';
import execa from 'execa';
import chalk from 'chalk';
import pa from 'path';

const getOpts = (opts: ?Object) => ({
  silent: opts != null && opts.silent != null ? opts.silent : false,
  exitOnError: opts != null && opts.exitOnError != null
    ? opts.exitOnError
    : true,
});
const execAs = async (
  path: string,
  command: string,
  args: Array<string> = [],
  opts: ?Object
): Promise<*> => {
  const { silent, exitOnError } = getOpts(opts);
  if (!silent) {
    console.log(chalk.gray(`> ${path} \n$ ${command} ${args.join(' ')} `));
  }
  let result;
  try {
    result = await execa(
      command,
      args,
      Object.assign({ cwd: pa.dirname(path), stdio: 'inherit' }, opts)
    );
    if (exitOnError && result && result.code !== 0) {
      console.log('err!!!');
      process.exit(result.code);
    }
  } catch (err) {
    if (exitOnError) {
      process.exit(1);
    } else {
      throw err;
    }
  }
  return result;
};

execAs.sync = (
  path: string,
  command: string,
  args: Array<string> = [],
  opts: ?Object
): * => {
  const { silent, exitOnError } = getOpts(opts);
  if (!silent) {
    console.log(
      chalk.gray(`> ${path} \n$ ${command} ${(args || []).join(' ')} `)
    );
  }
  let result;
  try {
    result = execa.sync(
      command,
      args,
      Object.assign({ cwd: pa.dirname(path), stdio: 'inherit' }, opts)
    );
    if (exitOnError && result && result.code !== 0) {
      process.exit(result.code);
    }
  } catch (err) {
    if (exitOnError) {
      process.exit(1);
    }
  }
  return result;
};

export default execAs;
