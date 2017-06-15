// @flow
import safeOrderedExec from './safeOrderedExec';

type Opts = {
  handleCycles?: boolean,
};

export default async function<T>(
  nodes: Array<T>,
  edges: Array<[T, T]>,
  opts?: Opts
): Promise<Array<T>> {
  const ordered = [];
  await safeOrderedExec(
    nodes,
    edges,
    node => ordered.push(node),
    Object.assign({}, opts, { concurrency: 1 })
  );
  return ordered;
}
