// @flow
'use strict';
import path from 'path';
import fs from 'fs';
import loadJsonFile from 'load-json-file';
import readPkg from 'read-pkg';

const fileExist = filename =>
  new Promise(resolve => {
    fs.lstat(filename, (err, stats) => {
      resolve(!err && stats.isFile());
    });
  });
const readConfig = async filename => {
  if (await fileExist(filename)) {
    return loadJsonFile(filename);
  }
  return null;
};
export default async (rootPkgPath: string) => {
  const rootPath = path.dirname(rootPkgPath);
  const [configFile, dotConfigFile, packageJson] = await Promise.all([
    readConfig(path.join(rootPath, 'mor.json')),
    readConfig(path.join(rootPath, '.mor.json')),
    readPkg(rootPkgPath),
  ]);
  return Object.assign(
    { rootPath },
    configFile,
    dotConfigFile,
    packageJson.mor
  );
};
