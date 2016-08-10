// @flow
import { Transform } from 'stream';
import chalk from 'chalk';
import padRight from './right-pad';

export default function prefixStream (packageName: string = '', maxLength: number, color: Function) {
  const prefix = color(padRight(packageName, maxLength)) + chalk.cyan(' | ');
  const ts: any = new Transform();
  let currentLine = '';
  function write (line) {
    ts.push(prefix + line + '\n');
  }
  ts._transform = function (chunk, enc, cb) {
    var split = (currentLine + chunk.toString()).split(/\r?\n/);
    currentLine = split.pop();
    split.forEach(write);
    cb();
  }
  ts._flush = function (cb) {
    write(currentLine);
    cb();
  }
  return ts;
}
