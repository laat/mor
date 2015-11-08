'use strict';
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const Graph = require('graphlib').Graph;
const alg = require('graphlib').alg;
const DFS = require('./alg/dfs');
const revDFS = require('./alg/revDfs.js');

const locatePackages = function (basepath) {
	let projects = [];
	const _tree = function (dir) {
		try {
			let stats = fs.statSync(dir);
			if (stats.isFile() && path.basename(dir) === 'package.json') {
				projects.push(dir);
			} else if (stats.isDirectory() && path.basename(dir) !== 'node_modules') {
				fs.readdirSync(dir).map(child => _tree(path.join(dir, child)));
			}
		} catch (e) {
			return;
		}
	};
	_tree(basepath);
	return projects;
};

const getPackages = function (packageFiles) {
	let packageMap = new Map();
	packageFiles.forEach(packageFile => {
		let data = require(packageFile);
		data.mor = data.mor || {pins: []};
		data._path = path.dirname(packageFile);
		packageMap.set(data.name, data);
	});
	return packageMap;
};

const packagesGraph = function (packagesMap, withNodes) {
	let g = new Graph();
	packagesMap.forEach(pkg => {
		g.setNode(pkg.name);
		Object.keys(pkg.dependencies || {})
			.concat(Object.keys(pkg.devDependencies || {}))
			.filter(dep => packagesMap.has(dep))
			.forEach(dep => g.setEdge(pkg.name, dep));
	});

	if (withNodes) {
		let notInGraph = _.without.apply(_, [Array.from(packagesMap.keys())].concat(withNodes));
		notInGraph.forEach(v => g.removeNode(v));
	}
	return g;
};

exports.packages = basepath => getPackages(locatePackages(basepath));
exports.graph = packagesGraph;
exports.order = graph => alg.topsort(graph).reverse();
exports.predecessors = revDFS;
exports.successors = DFS;
