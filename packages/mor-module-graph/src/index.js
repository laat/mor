// @flow
'use strict';
import semver from 'semver';
import Graph from 'mor-graph';
import execAs from './execAs';
import runScript from './runAs';

export interface Module {
  path: string,
  pkg: Object,
  +name: ?string,
  +version: ?string,
  +private: boolean,
  exec(command: string, args?: Array<string>, opts?: Object): Promise<any>,
  execSync(command: string, args?: Array<string>, opts?: Object): any,
  run(script: string, opts?: Object): Promise<any>,
  runSync(script: string, opts?: Object): void,
}

class ModuleGraphNode implements Module {
  path: string;
  pkg: Object;
  constructor({ path, pkg }: { path: string, pkg: Object }) {
    this.path = path;
    this.pkg = pkg;
  }
  get name(): ?string {
    return this.pkg.name;
  }
  get version(): ?string {
    return this.pkg.version;
  }
  get private(): boolean {
    return this.pkg.private || false;
  }
  exec(command: string, args?: Array<string>, opts?: Object) {
    return execAs(this.path, command, args, opts);
  }
  execSync(command: string, args?: Array<string>, opts?: Object) {
    return execAs.sync(this.path, command, args, opts);
  }
  run(script: string, opts?: Object) {
    return runScript(this, script, opts);
  }
  runSync(script: string, opts?: Object) {
    return runScript.sync(this, script, opts);
  }
  toString() {
    return `${this.pkg.name || this.path}@${this.pkg.version}`;
  }
  inspect() {
    return this.toString();
  }
}

type PrimitiveModule = {
  path: string,
  pkg: Object,
};
export default class ModuleGraph {
  _nodesByName: { [key: string]: ModuleGraphNode };
  _strictSemver: boolean;
  _graph: Graph<ModuleGraphNode>;
  constructor(
    modules: Array<PrimitiveModule> = [],
    strictSemver?: boolean = false
  ) {
    const nodes = [];
    this._nodesByName = {};
    const edges = [];
    this._strictSemver = strictSemver;

    modules.forEach(pkg => {
      const node = new ModuleGraphNode(pkg);
      nodes.push(node);
      if (pkg.pkg.name != null) {
        this._nodesByName[pkg.pkg.name] = node;
      }
    });

    nodes.forEach(node => {
      const dependencies = node.pkg.dependencies || {};
      const devDependencies = node.pkg.devDependencies || {};
      const allDependencies = Object.assign({}, devDependencies, dependencies);
      Object.entries(allDependencies).forEach(([name, version]) => {
        const depNode = this._nodesByName[name];
        if (depNode == null) {
          return;
        }
        if (
          strictSemver &&
          !semver.satisfies(depNode.pkg.version, (version: any))
        ) {
          return;
        }
        edges.push([node, depNode]);
      });
    });
    this._graph = new Graph(nodes, edges);
  }

  filter(filterFn: (n: ModuleGraphNode) => boolean) {
    const newNodes = this._graph.filter(filterFn).nodes.map(n => ({
      path: n.path,
      pkg: n.pkg,
    }));
    return new ModuleGraph(newNodes, this._strictSemver);
  }

  dependencies(packageName: string, opts?: { transitive: boolean }) {
    const { transitive } = Object.assign({}, { transitive: false }, opts);
    const packageNode = this._nodesByName[packageName];
    return this._graph.dependencies(packageNode, { transitive });
  }

  dependents(packageName: string, opts?: { transitive: boolean }) {
    const { transitive } = Object.assign({}, { transitive: false }, opts);
    const packageNode = this._nodesByName[packageName];
    return this._graph.dependents(packageNode, { transitive });
  }

  get modules(): Array<ModuleGraphNode> {
    return this._graph.nodes;
  }

  getPackage(packageName: ModuleGraphNode | string) {
    if (
      typeof packageName === 'string' &&
      this._nodesByName[packageName] != null
    ) {
      return this._nodesByName[packageName];
    }
    return this._graph.nodes.filter(({ path }) => path === packageName)[0];
  }

  async exec(command: string, args?: Array<string>, opts?: Object) {
    return this._graph.processSafeOrder(node => node.exec(command, args, opts));
  }
  execSync(command: string, args?: Array<string>, opts?: Object) {
    const orderedNodes = this._graph.ordered({ reverse: true });
    for (const node of orderedNodes) {
      node.execSync(command, args, opts);
    }
  }

  async execOrdered(command: string, args?: Array<string>, opts?: Object) {
    return this._graph.processSafeOrder(
      pkg => pkg.exec(command, args, opts),
      opts
    );
  }

  async processOrder(
    callback: (node: ModuleGraphNode) => *,
    opts: { concurrency?: number }
  ) {
    return this._graph.processOrder(callback, opts);
  }
  async processSafeOrder(
    callback: (node: ModuleGraphNode) => *,
    opts: { concurrency?: number, handleCycles?: boolean }
  ): Promise<void> {
    return this._graph.processSafeOrder(callback, opts);
  }

  run(script: string, opts?: Object) {
    return this._graph.processSafeOrder(node => node.run(script, opts));
  }
  runSync(script: string, opts?: Object) {
    const orderedNodes = this._graph.ordered({ reverse: true });
    for (const node of orderedNodes) {
      node.runSync(script, opts);
    }
  }
  async runOrdered(script: string, opts?: Object) {
    return this._graph.processSafeOrder(pkg => pkg.run(script, opts), opts);
  }
}
