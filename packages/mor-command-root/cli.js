#!/usr/bin/env node
// @flow
const path = require('path');
const core = require('mor-core').default;
const program = require('commander');

program
  .usage('[package]')
  .description('get the root folder [of a package]')
  .parse(process.argv);

(async () => {
  const pkgName = program.args[0];
  const mor = await core();
  if (pkgName == null) {
    console.log(mor.config.rootPath);
  } else {
    const withName = mor.workspaces.filter(ws => ws.pkg.name == pkgName);
    if (withName.length === 0) {
      console.error(`Could not find ${pkgName}`);
      process.exit(1);
    }
    console.log(path.dirname(withName[0].path));
  }
})();
