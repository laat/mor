// @flow
import test from 'tape';
import createDAG from './dag';

test('should be able to add nodes', (assert) => {
  const dag = createDAG();
  dag.addNode('a');
  dag.addNode('b');
  assert.ok(dag.hasNode('a'), 'a should exist in the DAG');
  assert.ok(dag.hasNode('b'), 'b should exist in the DAG');
  assert.end();
});

test('should be able to add edges', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  assert.ok(dag.hasNode('a'), 'a should exist in the DAG');
  assert.ok(dag.hasNode('b'), 'b should exist in the DAG');
  assert.ok(dag.to('a').length === 0, 'a should not have edges in');
  assert.ok(dag.to('b').length === 1, 'b should have one edge in');
  assert.ok(dag.from('b').length === 0, 'a should not have edges out');
  assert.ok(dag.from('a').length === 1, 'a should have one edge out');
  assert.end();
});

test('should be able to add multiple edges', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('b', 'c');
  assert.ok(dag.nodes().indexOf('a') >= 0, 'a should exist in the DAG');
  assert.ok(dag.nodes().indexOf('b') >= 0, 'b should exist in the DAG');
  assert.ok(dag.nodes().indexOf('c') >= 0, 'c should exist in the DAG');
  assert.ok(dag.to('a').length === 0, 'a should not have edges in');
  assert.ok(dag.to('b').length === 1, 'b should have one edge in');
  assert.ok(dag.to('c').length === 1, 'c should have one edge in');
  assert.ok(dag.from('c').length === 0, 'c should not have edges out');
  assert.ok(dag.from('b').length === 1, 'b should have one edge out');
  assert.ok(dag.from('a').length === 1, 'a should have one edge out');
  assert.end();
});

test('should be able to remove nodes', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('b', 'c');
  assert.ok(dag.hasNode('a'), 'a should exist in the DAG');
  assert.ok(dag.hasNode('b'), 'b should exist in the DAG');
  assert.ok(dag.hasNode('c'), 'c should exist in the DAG');
  dag.removeNode('b');
  assert.ok(dag.to('a').length === 0, 'a should not have edges in');
  assert.ok(dag.to('b').length === 0, 'b should not have edges in');
  assert.ok(dag.to('c').length === 0, 'c should not have edges in');
  assert.ok(dag.from('c').length === 0, 'c should not have edges out');
  assert.ok(dag.from('b').length === 0, 'b should not have edges out');
  assert.ok(dag.from('a').length === 0, 'a should not have edges out');
  assert.end();
});

test('should be able to get sinks', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('a', 'c');
  assert.ok(dag.sinks().length === 2, 'should have 2 sinks');
  assert.ok(dag.sinks().indexOf('a') === -1, 'a should not be a sink');
  assert.ok(dag.sinks().indexOf('b') >= 0, 'b should be a sink');
  assert.ok(dag.sinks().indexOf('c') >= 0, 'c should be a sink');
  assert.end();
});

test('should be able to get sources', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('a', 'c');
  dag.addEdge('d', 'b');
  assert.ok(dag.sources().length === 2, 'should have 2 sources');
  assert.ok(dag.sources().indexOf('b') === -1, 'b should not be a source');
  assert.ok(dag.sources().indexOf('c') === -1, 'c should not be a source');
  assert.ok(dag.sources().indexOf('a') >= 0, 'b should be a source');
  assert.ok(dag.sources().indexOf('d') >= 0, 'd should be a source');
  assert.end();
});

test('should find depth first preorder', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('b', 'c');

  const result = dag.dfs('a');

  assert.equal(result[0], 'a', 'a is first');
  assert.equal(result[1], 'b', 'b is second');
  assert.equal(result[2], 'c', 'c is last');
  assert.end();
});
test('should find depth first for multiple nodes', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('c', 'd');

  const result = dag.dfsNodes(['a', 'c']);

  assert.equal(result[0], 'a', 'a is first');
  assert.equal(result[1], 'b', 'b is second');
  assert.equal(result[2], 'c', 'c is third');
  assert.equal(result[3], 'd', 'd is last');
  assert.end();
});
test('should find reverse depth first preorder', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('b', 'c');

  const result = dag.dfs('c', true);

  assert.equal(result[0], 'c', 'c is first');
  assert.equal(result[1], 'b', 'b is second');
  assert.equal(result[2], 'a', 'a is last');
  assert.end();
});
test('should find reverse depth first for multiple nodes', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('c', 'd');

  const result = dag.dfsNodes(['b', 'd'], true);

  assert.equal(result[0], 'b', 'b is first');
  assert.equal(result[1], 'a', 'a is second');
  assert.equal(result[2], 'd', 'd is third');
  assert.equal(result[3], 'c', 'c is last');
  assert.end();
});
test('should find topological order', (assert) => {
  const dag = createDAG();
  dag.addEdge('a', 'b');
  dag.addEdge('b', 'c');

  const result = dag.topsort();

  assert.equal(result[0], 'a', 'a is first');
  assert.equal(result[1], 'b', 'b is second');
  assert.equal(result[2], 'c', 'c is last');
  assert.end();
});
