// @flow

import pify from 'pify';
import nativeFs from 'fs';
import path from 'path';
import minimatch from 'minimatch';
import reEscape from 'escape-string-regexp';

const fs = pify(nativeFs);
const cwd = process.cwd();

function getIgnored() {
  return [
    "**/node_modules/*",
    "**/.git"
  ];
}

const isIgnored = (workdir, patterns) => {
  const re = new RegExp(`^${reEscape(workdir)}`);
  return path => {
    return patterns.some(pattern => minimatch(path.replace(re, ''), pattern));
  }
}

async function getPackages(workdir: string): Promise<Array<string>> {
  const projects = [];
  const shouldSkip = isIgnored(workdir, getIgnored());
  async function _walk(dir) {
    try {
      const stats = await fs.stat(dir)
      if (stats.isFile() && path.basename(dir) === 'package.json') {
        projects.push(dir)
      } else if (stats.isDirectory()) {
        const visit = !shouldSkip(dir);
        if (visit) {
          const dirs = await fs.readdir(dir)
          await Promise.all(dirs.map(async function (child) {
            await _walk(path.join(dir, child))
          }))
        }
      }
    } catch (e) {
      return
    }
  }
  await _walk(workdir);
  return projects;
}

export default getPackages;
