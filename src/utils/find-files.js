// @flow
import pify from 'pify';
import nativeFs from 'fs';
import path from 'path';
import minimatch from 'minimatch';
import reEscape from 'escape-string-regexp';

const fs = pify(nativeFs);

const isIgnored = (workdir, patterns) => {
  const re = new RegExp(`^${reEscape(workdir)}`);
  return async file =>
    (await patterns).some(pattern => minimatch(file.replace(re, ''), pattern));
};

async function findFiles(
    filename: string,
    workdir: string,
    ignore?: Array<string> = []
): Promise<Array<string>> {
  const projects = [];
  const shouldSkip = isIgnored(workdir, ignore);
  async function _walk(dir) {
    try {
      const stats = await fs.stat(dir);
      if (stats.isFile() && path.basename(dir) === filename) {
        projects.push(dir);
      } else if (stats.isDirectory()) {
        const visit = !await shouldSkip(dir);
        if (visit) {
          const dirs = await fs.readdir(dir);
          await Promise.all(dirs.map(async child => await _walk(path.join(dir, child))));
        }
      }
    } catch (e) {
      return;
    }
  }
  await _walk(workdir);
  return projects;
}

export default findFiles;
