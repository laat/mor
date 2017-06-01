// @flow
/* eslint-disable no-plusplus */
'use strict';
import PQueue from 'p-queue';

type Opts = {
  concurrency?: number,
  handleCycles?: boolean,
};
export default async function<T>(
  nodes: Array<T>,
  edges: Array<[T, T]>,
  processor: (node: T) => *,
  opts?: Opts
) {
  let concurrency = 4;
  let handleCycles = false;
  if (opts != null && opts.concurrency != null) {
    concurrency = opts.concurrency;
  }
  if (opts != null && opts.handleCycles != null) {
    handleCycles = opts.handleCycles;
  }
  const visits = [];
  const queue = new PQueue({ concurrency });
  const visited: { [key: T]: boolean } = {};
  const finished: { [key: T]: boolean } = {};
  const counts: { [key: T]: number } = {};
  const dependents: { [key: T]: Array<T> } = {};
  nodes.forEach(node => {
    const nodeDependencies = edges
      .filter(([from]) => from === node)
      .map(([from]) => from);
    const nodeDependents = edges
      .filter(([, to]) => to === node)
      .map(([from]) => from);
    counts[node] = nodeDependencies.length;
    dependents[node] = nodeDependents;
  });
  const visit = async node => {
    if (visited[node]) {
      return;
    }
    visited[node] = true;
    const nodeDependents = dependents[node] || [];
    await Promise.resolve(processor(node));
    finished[node] = true;
    for (const dep of nodeDependents) {
      if (--counts[dep] === 0) {
        visits.push(queue.add(() => visit(dep)));
      }
    }
  };
  for (const node of nodes) {
    if (counts[node] === 0) {
      visits.push(queue.add(() => visit(node)));
    }
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(visits);
    if (Object.keys(finished).length === nodes.length) {
      break;
    }
    if (Object.keys(finished).length === Object.keys(visited).length) {
      if (handleCycles) {
        const notVisited = nodes.filter(
          node => !Object.keys(visited).includes(String(node))
        );
        const next = notVisited.reduce(
          (min, node) => {
            if (counts[node] < min.count) {
              return { node, count: counts[node] };
            }
            return min;
          },
          { node: null, count: Number.POSITIVE_INFINITY }
        ).node;
        if (next != null) {
          visits.push(queue.add(() => visit(next)));
        }
      } else {
        throw new Error('Cycle detected');
      }
    }
  }
}
