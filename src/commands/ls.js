// @flow
/* eslint-disable no-console */
import getPackages from '../packages';
import getConfig from '../config';

async function ls() {
  const config = await getConfig();
  const packages = await getPackages(config);
  return packages.all().map(pkg => pkg.name);
}

ls().then(l => console.log(l)).catch(e => console.err(e));
