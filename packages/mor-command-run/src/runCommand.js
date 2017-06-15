// @flow
import type { ModuleGraphNode } from 'mor-core';
import path from 'path';
import chalk from 'chalk';
import npmRunPath from 'npm-run-path';
import supportsColor from 'supports-color';

export default (script: string, createLogger: Function) => async (
  node: ModuleGraphNode
) => {
  const logger = createLogger();
  try {
    const result = await node.run(script, {
      silent: true,
      preferLocal: true,
      exitOnError: false,
      env: Object.assign(
        {},
        process.env,
        npmRunPath({
          path: process.env.PATH || '',
          cwd: path.dirname(node.path),
        }),
        supportsColor ? { FORCE_COLOR: true } : {}
      ),
      stdio: [],
    });
    if (result != null) {
      logger(
        `${chalk.reset.inverse.green(
          'DONE'
        )} npm run ${script}\n${result.stdout}`
      );
    } else {
      logger(
        `${chalk.reset.inverse.yellow('SKIP')} ${node.name ||
          node.path} no script ${script}`
      );
    }
  } catch (err) {
    console.log({ err });
    logger(`chalk.reset.inverse.red('DONE') npm run ${script}\n${err.stdout}`);
    logger(err.stdout);
    logger(`${chalk.red('ERROR')} ${node.name || node.path}: ${err.message}`);
    process.exit(1);
  }
};
