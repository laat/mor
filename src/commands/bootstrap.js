// @flow
import parallelLimit from '../utils/parallel-limit';
import entries from '../utils/entries';
import getPackages, { mergedDependencies, readPackage } from '../packages';
import getConfig from '../config';
import npm from '../utils/npm';

import path from 'path';
import pify from 'pify';
import nativeFs from 'fs-extra';
import semver from 'semver';

const fs = pify(nativeFs);

function len(string?: string) {
  if(string != null) {
    return string.length
  } else {
    return 0;
  }
}

async function link() {
  const config = await getConfig();
  const packages = await getPackages(config);
  const maxLength = Math.max.apply(null , packages.all().map(pkg => len(pkg.name)));

  let morDependencies = [];
  for (const [name, version] of entries(mergedDependencies(config.package))) {
    const morDependency = await readPackage(`${config._root}/node_modules/${name}/package.json`);
    morDependencies.push(morDependency);
  }

  for (const pkg of packages.all()) {
    // link local packages
    for (const dep of packages.dependencies(pkg.name)) {
      await npm.link(pkg, dep);
    }
    // link devDependencies installed in root project
    for (const [name, version] of entries(pkg.devDependencies || {}))   {
      const morDependency = morDependencies
      .find(dep => dep.name === name && semver.satisfies(dep.version, version));
      if (morDependency) {
        await npm.link(pkg, morDependency);
      }
    }
  }

  await parallelLimit(packages.all().map(pkg => async () => {
    const externalDependencies = entries(mergedDependencies(pkg))
    .filter(([name, version]) => !packages.dependencies(pkg.name).some(dep => dep.name === name))
    .filter(([name]) => {
      // already installed
      try {
        fs.statSync(`${pkg._root}/node_modules/${name}`);
        return false;
      } catch (err){
        return true;
      }
      })
    .filter(([name, version]) => !morDependencies.some(dep => dep.name === name && semver.satisfies(dep.version, version)))
    .map(([name, version]) => `${name}@${version}`)
    .join(' ');

    if (pkg.scripts && pkg.scripts.preinstall) {
      await npm.run('preinstall', pkg, maxLength);
    }
    if (externalDependencies !== '') {
      console.log(`> ${pkg.name || ''} npm install ${externalDependencies}`);
      await npm.exec(`npm install ${externalDependencies}`, pkg, maxLength);
    }
    if (pkg.scripts && pkg.scripts.postinstall) {
      await npm.run('postinstall', pkg, maxLength);
    }
    if (pkg.scripts && pkg.scripts.prepublish) {
      await npm.run('prepublish', pkg, maxLength);
    }
  }), 8);
}

link().then(ls => console.log(ls)).catch(e => console.error(e));
