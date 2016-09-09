// @flow
import hasFlag from 'has-flag';

let _verbose = false;
export const setVerbose = (verbose: boolean) => {
  _verbose = verbose;
};
export default () => !process.stdout.isTTY || hasFlag('verbose') || _verbose;
