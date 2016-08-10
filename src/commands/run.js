// @flow
import getPackages from '../packages';
import getConfig from '../config';
import npm from '../utils/npm';

async function run(command: string) {
  try {
  const config = await getConfig();
  const packages = await getPackages(config);
  return packages
    .all()
    .filter(pkg => pkg.scripts && pkg.scripts[command])
    .forEach(pkg => npm.runSync(command, pkg));
  } catch (err) {
    console.log(err);
  }
}

run('build').then(ls => console.log(ls)).catch(e => console.err(e));
