// @flow
import getPackages from '../packages';
import getConfig from '../config';

async function ls() {
  const config = await getConfig();
  const packages = await getPackages(config);
  return packages.all().map(pkg => pkg.name);
}

ls().then(ls => console.log(ls)).catch(e => console.err(e));
