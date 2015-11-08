#!/usr/bin/env node
'use strict';
const doc = `Trollmor. the monolithic repository manager

Usage:
  mor ls [<package> [--predecessors]] [--dot | --path]
  mor path <package>...
  mor cycles
  mor link
  mor pins
  mor outdated
  mor i | install
  mor t | test

Options:
  --pre, --predecessors  All packages dependending on <package>
  --dot                  Output as graphviz-dot

Examples:
  mor ls --path
  mor ls --dot | graph-easy  # apt-get install libgraph-easy-perl
`;
const pjson = require('./package.json');
const sh = require('shelljs');
const dot = require('graphlib-dot');
const alg = require('graphlib').alg;

const core = require('./mor-core.js');
const outdated = require('./mor-outdated.js');
const link = require('./mor-link.js');

const args = require('docopt').docopt(doc, {version: pjson.version});

const logArray = arr => arr.forEach(v => console.log(v));
const packages = core.packages(sh.pwd());
const graph = core.graph(packages);

if (args.path) {
	args['<package>'].forEach(pkg => {
		console.log(packages.get(pkg)._path);
	});
}

if (args.cycles) {
	var keepNodes = [];
	alg.findCycles(graph).forEach(cycle => cycle.forEach(node => keepNodes.push(node)));
	console.log(dot.write(core.graph(packages, keepNodes)));
}

if (args.outdated) {
	outdated(packages);
}

if (args.ls) {
	let list;
	if (args['<package>'].length) {
		let pkg = args['<package>'][0];
		if (args['--predecessors']) {
			list = core.predecessors(graph, pkg);
		} else {
			list = core.successors(graph, pkg);
		}
	} else {
		list = Array.from(packages.keys());
	}
	if (args['--dot']) {
		console.log(dot.write(core.graph(packages, list)));
	} else if (args['--path']) {
		logArray(list.map(k => packages.get(k)._path));
	} else {
		logArray(list);
	}
}

if (args.link) {
	link(packages, graph);
}

if (args.test || args.t) {
	let order = core.order(graph);
	order.forEach(pkg => {
		if (sh.exec(`cd ${packages.get(pkg)._path} && npm test`).code !== 0) {
			process.exit(1);
		}
	});
	outdated(packages);
}

if (args.install || args.i) {
	let order = core.order(graph);
	order.forEach(pkg => {
		console.log('\ninstall', pkg);
		if (sh.exec(`cd ${packages.get(pkg)._path} && npm install`).code !== 0) {
			process.exit(1);
		}
	});
}

if (args.pins) {
	let order = core.order(graph);
	order.forEach(pkg => {
		let mor = packages.get(pkg).mor || {};
		let pins = mor.pins || [];
		pins.forEach(pin => console.log(pkg, 'has pinned', pin));
	});
}
