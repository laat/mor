// @flow
import type { Package } from './packages';
import path from 'path';
import findUp from 'find-up';
import pify from 'pify';
import nativeFs from 'fs';

const fs = pify(nativeFs);

export type Config = {
  _root: string,
  package: Package,
  ignore?: Array<string>,
};

async function getConfig(): Promise<Config> {
  const configFile = await findUp('.mor.json');
  const file = await fs.readFile(configFile);
  const config = JSON.parse(file);
  config._root = path.dirname(configFile);

  const packageFile = await fs.readFile(`${config._root}/package.json`);
  config.package = JSON.parse(packageFile);
  return config;
}
export default getConfig;
