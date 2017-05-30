// @flow
/* eslint-env jest */
'use strict';
import orderedExec from './safeOrderedExec';

const delay = timeout =>
  // eslint-disable-next-line promise/avoid-new
  new Promise(resolve => {
    setTimeout(resolve, timeout);
  });

test('orderedExec', async () => {
  const order = [];
  const nodes = ['a', 'b', 'c'];
  const edges = [['c', 'a'], ['b', 'a']];
  await orderedExec(nodes, edges, async node => {
    if (node === 'c') {
      await delay(10);
    }
    if (node === 'b') {
      await delay(100);
    }
    order.push(node);
  });
  expect(order).toEqual(['a', 'c', 'b']);
});
test('orderedExec handleCycles', async () => {
  const order = [];
  const nodes = ['a', 'b', 'c', 'd'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', ''], ['b', 'd']];
  await orderedExec(
    nodes,
    edges,
    async node => {
      order.push(node);
    },
    { handleCycles: true }
  );
  expect(order).toEqual(['d', 'a', 'b', 'c']);
});
