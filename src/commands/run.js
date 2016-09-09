// @flow
/* eslint-disable no-console */
import getPackages from '../packages';
import getConfig from '../config';
import npm from '../utils/npm';

async function run(command: string) {
  try {
    const config = await getConfig();
    const packages = await getPackages(config);
    packages
      .all()
      .filter(pkg => pkg.scripts && pkg.scripts[command])
      .forEach(pkg => npm.runSync(command, pkg));
  } catch (err) {
    console.log(err);
  }
}

run('build').then(l => console.log(l)).catch(e => console.err(e));
