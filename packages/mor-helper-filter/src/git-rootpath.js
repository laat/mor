// @flow
import { exec } from 'child_process';
export default (): Promise<string> =>
  new Promise((resolve, reject) => {
    exec('git rev-parse --show-toplevel', (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.toString().trim());
      }
    });
  });
