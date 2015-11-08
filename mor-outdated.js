'use strict';
var semver = require('semver');

module.exports = function (packages) {
	// TODO: should not exit
	var isOutdated = false;
	for (let pkg of packages) {
		let deps = pkg[1].dependencies || {};
		let pins = pkg[1].mor.pins || [];
		Object.keys(deps).forEach(dep => {
			if (packages.has(dep) && pins.indexOf(dep) < 0) {
				var realVersion = packages.get(dep).version;
				var depVersion = deps[dep];
				var isLatest = semver.satisfies(realVersion, depVersion);
				if (!isLatest) {
					console.error(`ERROR: ${dep} is old in ${pkg[1].name}: was ${depVersion}, expected ${realVersion} `);
					isOutdated = true;
				}
			}
		});
	}
	if (isOutdated) {
		process.exit(1);
	}
	process.exit(0);
};
