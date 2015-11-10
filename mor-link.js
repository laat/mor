'use strict';
const sh = require('shelljs');
const path = require('path');
const chalk = require('chalk');
const core = require('./mor-core.js');

module.exports = function (packages, graph) {
	packages.forEach(pkg => {
		let nodeModulesPath = path.join(pkg._path, 'node_modules');
		core.successors(graph, pkg.name).forEach(successor => {
			if (successor === pkg.name) {
				return;
			}
			if (pkg.mor.pins.indexOf(successor) >= 0) {
				console.log(`${chalk.yellow('WARN')}: skipping ${successor} in ${pkg.name}, it was pinned`);
				return;
			}
			if (successor[0] === '@') {
				sh.mkdir('-p', path.join(nodeModulesPath, pkg.name.split('/')[0]));
			}
			sh.ln('-sf', packages.get(successor)._path, path.join(nodeModulesPath, successor));
		});
	});
};
