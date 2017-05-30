// @flow
'use strict';
import PQueue from 'p-queue';
import toposort from 'toposort';
// TODO: toposort does not support cycles, reimplement with cyle breaking

export default async function<T>(
  nodes: Array<T>,
  edges: Array<[T, T]>,
  processor: (node: T) => *,
  opts?: { concurrency?: number }
) {
  const queue = new PQueue(opts);
  const ordered = toposort.array(nodes, edges);
  ordered.forEach(node => {
    queue.add(() => processor(node));
  });
  await queue.onEmpty();
}
