#!/usr/bin/env node
'use strict';
const doc = `Trollmor. the monolithic repository manager

Usage:
  mor ls [options] [<package>...]
  mor exec COMMAND [<package>...]
  mor cycles [--dot]
  mor link
  mor pins
  mor outdated
  mor i | install
  mor t | test

Options:
  --pre, --predecessors  All packages dependending on <package>
  --dot                  Output as graphviz-dot
  --path                 Output as paths
  -c COMMAND             Execute command with packages

Examples:
  mor ls --path
  mor ls --dot | graph-easy  # apt-get install libgraph-easy-perl
  mor exec "npm t"
`;
const pjson = require('./package.json');
const _ = require('lodash');
const sh = require('shelljs');
const dot = require('graphlib-dot');

const core = require('./mor-core.js');
const outdated = require('./mor-outdated.js');
const link = require('./mor-link.js');
const exec = require('./mor-exec.js');

const args = require('docopt').docopt(doc, {version: pjson.version});

const logArray = arr => arr.forEach(v => console.log(v));
const packages = core.packages(sh.pwd());
const graph = core.graph(packages);

let list = [];
if (args['<package>'].length) {
	args['<package>'].forEach(pkg => {
		if (args['--predecessors']) {
			list = list.concat(core.predecessors(graph, pkg));
		} else {
			list = list.concat(core.successors(graph, pkg));
		}
	});
	list = _.uniq(list);
} else {
	list = Array.from(packages.keys());
}

if (args.ls) {
	if (args['--dot']) {
		console.log(dot.write(core.graph(packages, list)));
	} else if (args['--path']) {
		logArray(list.map(pkg => packages.get(pkg)._path));
	}	else if (args['-c']){
		exec(list.map(pkg => packages.get(pkg)), args['-c']);
	} else {
		logArray(list);
	}
}

if (args.exec) {
	exec(list.map(pkg => packages.get(pkg)), args['COMMAND']);
}

if (args.cycles) {
	let cycles = core.cycles(graph);
	if (args['--dot']) {
		let keepNodes = [];
		cycles.forEach(cycle => cycle.forEach(node => keepNodes.push(node)));
		console.log(dot.write(core.graph(packages, keepNodes)));
	} else {
		logArray(cycles);
	}
}

if (args.outdated) {
	outdated(packages);
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
