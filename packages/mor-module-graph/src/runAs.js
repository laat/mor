// @flow
'use strict';
import pa from 'path';
import execAs from './execAs';

type Module = {
  path: string,
  pkg: Object,
};
const scriptIsValid = ({ path, pkg }, script, opts) => {
  if ((pkg.scripts || {})[script] == null) {
    if (opts && opts.failOnMissing === true) {
      throw new Error(
        `Script [${script}] is missing from ${pa.join(path, 'package.json')}`
      );
    } else {
      return false;
    }
  }
  return true;
};
const runScript = async (
  { path, pkg }: Module,
  script: string,
  opts: ?Object
): Promise<*> => {
  if (!scriptIsValid({ path, pkg }, script, opts)) {
    return undefined;
  }
  return execAs(path, 'yarn', ['run', script], opts);
};

runScript.sync = ({ path, pkg }: Module, script: string, opts?: Object): * => {
  if (!scriptIsValid({ path, pkg }, script, opts)) {
    return undefined;
  }
  return execAs.sync(path, 'yarn', ['run', script], opts);
};

export default runScript;
