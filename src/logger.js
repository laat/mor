// @flow
/* eslint-disable no-console */
import stripAnsi from 'strip-ansi';
import nativeFs from 'fs-extra';
import pify from 'pify';
import isVerbose from './utils/is-verbose';

const fs = pify(nativeFs);

const logs = [];

const TRACE = 0;
const DEBUG = 1;
const INFO = 2;
const WARN = 3;
const ERROR = 4;

const _log = (level, ...args) => {
  if (!isVerbose()) {
    let line = args.map(a => {
      if (typeof a === 'string') {
        return stripAnsi(a);
      }
      return a;
    });
    if (line.length === 1) {
      line = line[0];
    }
    logs.push(line);
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
const dumpLogs = async () => {
  const lines = [];
  logs.forEach(l => {
    if (typeof l === 'string') {
      lines.push(l);
    } else {
      lines.push(JSON.stringify(l, null, 2));
    }
  });
  await fs.writeFile('mor-debug.log', lines.join('\n'), 'utf8');
  console.log('dumped logs to mor-debug.log');
};

export default {
  trace,
  debug,
  info,
  warn,
  error,
  dumpLogs,
};
