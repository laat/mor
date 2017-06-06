// @flow
import path from 'path';
import chalk from 'chalk';
import npmRunPath from 'npm-run-path';
import supportsColor from 'supports-color';

import type { ModuleGraphNode } from 'mor-core';
import type { ProcessingError } from './types';

require('draftlog').into(console, supportsColor);
// $FlowIgnore
const logger = console.draft.bind(console);

export default (errors: Array<ProcessingError>, verbose: boolean) => async (
  ws: ModuleGraphNode
) => {
  const cwd = path.dirname(ws.path);
  const name = ws.name || cwd;
  let status;
  if (verbose) {
    status = console.log.bind(console);
  } else {
    status = logger();
  }
  if (!ws.pkg.scripts || !ws.pkg.scripts.test) {
    status(
      `${chalk.reset.inverse.green.bold(' SKIP ')} ${name} ${chalk.yellow('no test script')}`
    );
    return;
  }
  try {
    status(`${chalk.reset.inverse.yellow.bold(' RUNS ')} ${name} $ yarn test`);
    const result = await ws.run('test', {
      silent: true,
      preferLocal: true,
      exitOnError: false,
      env: Object.assign(
        {},
        process.env,
        npmRunPath({ path: process.env.PATH || '', cwd }),
        supportsColor ? { FORCE_COLOR: true } : {}
      ),
      stdio: [],
    });
    if (verbose) {
      status(
        `${chalk.reset.inverse.green.bold(' PASS ')} ${name} $ yarn test \n ${result.stdout}`
      );
    } else {
      status(`${chalk.reset.inverse.green.bold(' PASS ')} ${name} $ yarn test`);
    }
  } catch (err) {
    status(`${chalk.reset.inverse.red.bold(' FAIL ')} ${name} $ yarn test`);
    errors.push({ ws, err });
  }
};
