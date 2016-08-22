// @flow
/* eslint-disable no-console */
import isVerbose from './utils/is-verbose';

const logs = [];

const TRACE = 0;
const DEBUG = 1;
const INFO = 2;
const WARN = 3;
const ERROR = 4;

const _log = (level, ...args) => {
  if (isVerbose()) {
    logs.push(level, args);
  } else if (level === ERROR) {
    console.error(...args);
  } else {
    console.log(...args);
  }
};

const trace = (...args: any) => _log(TRACE, ...args);
const debug = (...args: any) => _log(DEBUG, ...args);
const info = (...args: any) => _log(INFO, ...args);
const warn = (...args: any) => _log(WARN, ...args);
const error = (...args: any) => _log(ERROR, ...args);

export default {
  trace,
  debug,
  info,
  warn,
  error,
};
