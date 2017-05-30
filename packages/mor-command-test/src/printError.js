/* eslint-disable no-console */
// @flow
import chalk from 'chalk';
import type { ProcessingError } from './types';

export default ({ ws, err }: ProcessingError) => {
  console.error();
  const padded = n => ` ${n} `;
  console.error(
    `${chalk.reset.inverse.red.bold(padded(ws.name || ws.path))} failed with:`
  );
  console.error(chalk.grey(`> ${ws.path}`));
  if (err && err.stdout) {
    console.log(err.stdout);
    console.error(err.stderr);
  } else {
    console.error(err);
  }
};
