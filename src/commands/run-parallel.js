// @flow
import parallelLimit from '../utils/parallel-limit';
import getPackages from '../packages';
import getConfig from '../config';
import npm from '../utils/npm';
import padRight from '../utils/right-pad';
import chalk from 'chalk';


function len(string?: string) {
  if(string != null) {
    return string.length
  } else {
    return 0;
  }
}
async function runParallel(command: string) {
  try {
    const config = await getConfig();
    const packages = await getPackages(config);
    const maxLength = Math.max.apply(null , packages.all().map(pkg => len(pkg.name)));
    const tasks = packages
      .all()
      .filter(pkg => pkg.scripts && pkg.scripts[command])
      .map(pkg => () => npm.run(command, pkg, maxLength));
    await parallelLimit(tasks, 8);
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
}

runParallel('build').then(ls => console.log(ls)).catch(e => console.err(e));
