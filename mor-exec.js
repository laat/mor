'use strict';
const sh = require('shelljs');
const chalk = require('chalk');

module.exports = function (packages, cmd) {
	packages.forEach(pkg => {
		let output = sh.exec(`cd "${pkg._path}" && ${cmd}`);
		if(output.code != 0) {
			console.error(`${chalk.red('ERROR')}: subprocess exited with ${output.code}`);
			process.exit(1);
		}
	});
};
