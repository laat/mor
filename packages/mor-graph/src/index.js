// @flow
'use strict';
import toposort from 'toposort';
import dfs from 'depth-first';
import orderedExec from './orderedExec';
import safeOrderedExec from './safeOrderedExec';

export interface IGraph<T> {
  +nodes: Array<T>,
  filter(fn: (node: T) => boolean): IGraph<T>,
  dependencies(node: T, opts?: { transitive: boolean }): Array<T>,
  dependents(node: T, opts?: { transitive: boolean }): Array<T>,
}

export default class Graph<T> implements IGraph<T> {
  _nodes: Array<T>;
  _edges: Array<[T, T]>;
  constructor(nodes: Array<T>, edges: Array<[T, T]>) {
    this._nodes = nodes;
    this._edges = edges;
  }
  filter(fn: (node: T) => boolean): IGraph<T> {
    const nodes = this._nodes.filter(fn);
    const edges = this._edges.filter(e => fn(e[0]) || fn(e[1]));
    return new Graph(nodes, edges);
  }
  get nodes(): Array<T> {
    return Object.freeze(this._nodes.slice());
  }
  dependencies(node: T, opts?: { transitive: boolean }): Array<T> {
    if (opts && opts.transitive === true) {
      return dfs(this._edges, node).filter(edge => edge !== node);
    }
    return this._edges.filter(([from]) => node === from).map(([, to]) => to);
  }
  dependents(node: T, opts?: { transitive: boolean }): Array<T> {
    if (opts && opts.transitive === true) {
      return dfs(this._edges, node, { reverse: true }).filter(
        edge => edge !== node
      );
    }
    return this._edges.filter(([, to]) => node === to).map(([from]) => from);
  }
  ordered(opts: { reverse: boolean }): Array<T> {
    if (opts && opts.reverse === true) {
      toposort.array(this._nodes, this._edges).reverse();
    }
    return toposort.array(this._nodes, this._edges);
  }
  processOrder(processor: (node: T) => *, opts?: { concurrency?: number }) {
    return orderedExec(this._nodes, this._edges, processor, opts);
  }
  processSafeOrder(
    processor: (node: T) => *,
    opts?: { concurrency?: number, handleCycles?: boolean }
  ) {
    return safeOrderedExec(this._nodes, this._edges, processor, opts);
  }
}
