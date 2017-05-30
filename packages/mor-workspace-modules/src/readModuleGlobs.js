// @flow
import globby from 'globby';
import path from 'path';
import readPkg from 'read-pkg';

const DEFAULT_IGNORE = ['**/node_modules/*'];
export default async (globs: Array<string>, cwd: string = process.cwd()) => {
  const possibleModules: Array<string> = await globby(globs, {
    cwd,
    ignore: DEFAULT_IGNORE,
  });
  // $FlowIgnore
  const modules: Array<Module> = (await Promise.all(
    possibleModules.map(async pkgPath => {
      try {
        const absolute = path.join(cwd, pkgPath);
        const pkg: Object = await readPkg(absolute);
        return {
          pkg,
          path: path.join(absolute, 'package.json'),
        };
      } catch (err) {
        return {};
      }
    })
  )).filter(pkg => pkg.path != null);
  return modules;
};
