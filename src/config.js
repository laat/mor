// @flow
import findUp from 'find-up';
import pify from 'pify';
import nativeFs from 'fs';

const fs = pify(nativeFs);

export type Config = {
  ignore?: ?Array<string>,
};

async function getConfig(): Promise<Config>{
  try {
    const path = await findUp('.mor.json');
    const file = await fs.readFile(path);
    return JSON.parse(file);
  } catch (err) {
    return {};
  }
}
export default getConfig;
