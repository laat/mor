// @flow
type FilterFunction = (v: string) => boolean;
type DAG<T, U> = {
  to: (v: string) => Array<string>,
  from: (v: string) => Array<string>,
  node: (v: string) => T,
  nodes: () => Array<string>,
  sources: () => Array<string>,
  sinks: () => Array<string>,
  edge: (v: string, w: string) => U,

  hasNode: (v: string) => boolean,
  removeNode: (v: string) => void,
  addNode: (v: string, value: ?T) => void,
  addEdge: (v: string, w: string, label: U) => void,

  filter: (filterFunction: FilterFunction) => DAG<T, U>,
  dfs: (startNode: string, backwards: ?boolean) => Array<string>,
  dfsNodes: (startNode: Array<string>, backwards: ?boolean) => Array<string>,
  topsort: () => Array<string>,
}

function createDAG<T, U>(): DAG<T, U> {
  const _nodes: { [v: string]: ?T } = {};
  const _to: { [v: string]: { [w: string]: U } } = {};
  const _from: { [v: string]: { [w: string]: U } } = {};

  const to = (v) => Object.keys(_to[v] || {});
  const from = (v) => Object.keys(_from[v] || {});
  const nodes = () => Object.keys(_nodes);
  const edge = (v, w) => _from[v][w];

  const sources = () => nodes().filter(v => to(v).length === 0);
  const sinks = () => nodes().filter(v => from(v).length === 0);
  const node = (v) => {
    const val = _nodes[v];
    if (val == null) {
      throw new Error(`${v} has not been added`);
    }
    return val;
  };

  const hasNode = (v) => ({}.hasOwnProperty.call(_nodes, v));
  const addNode = (v, value) => {
    _nodes[v] = value;
    _to[v] = _to[v] || {};
    _from[v] = _from[v] || {};
  };

  const addEdge = (v, w, label) => {
    if (!hasNode(v)) {
      addNode(v);
    }
    if (!hasNode(w)) {
      addNode(w);
    }
    _to[w][v] = label;
    _from[v][w] = label;
  };

  const removeNode = (v: string) => {
    to(v).forEach((w) => delete _from[w][v]);
    from(v).forEach((w) => delete _to[w][v]);
    delete _nodes[v];
    delete _to[v];
    delete _from[v];
  };

  const filter = function filter(filterFunction) {
    const filtered: DAG<T, U> = createDAG();
    nodes().forEach(v => {
      if (filterFunction(v)) {
        filtered.addNode(v, node(v));
      }
    });
    filtered.nodes().forEach((v) => {
      to(v).forEach(w => {
        if (filtered.hasNode(w)) {
          filtered.addEdge(w, v, edge(w, v));
        }
      });
      from(v).forEach(w => {
        if (filtered.hasNode(w)) {
          filtered.addEdge(v, w, edge(v, w));
        }
      });
    });
    return filtered;
  };

  const dfs = function dfs(startNode, backwards) {
    const visited: {[key: string]: boolean} = {};
    const result = [];
    function dfsNode(v: string, backwards: ?boolean) { // eslint-disable-line no-shadow
      result.push(v);
      visited[v] = true;

      let next: string[];
      if (backwards) {
        next = to(v);
      } else {
        next = from(v);
      }

      next.forEach(w => {
        if (!visited[w]) {
          dfsNode(w, backwards);
        }
      });
    }
    dfsNode(startNode, backwards);
    return result;
  };

  const dfsNodes = (searchNodes, backwards) => {
    const included = [];
    searchNodes.forEach((name) => {
      dfs(name, backwards).forEach((pre) => {
        included.push(pre);
      });
    });
    return included;
  };

  const topsort = () => {
    const visited: {[key: string]: boolean} = {};
    const stack: {[key: string]: boolean} = {};
    const results: Array<string> = [];

    sinks().forEach(function visit(v) {
      if (stack[v]) {
        throw new Error('Cycle detected');
      }
      if (!visited[v]) {
        stack[v] = true;
        visited[v] = true;
        to(v).forEach(visit);
        delete stack[v];
        results.push(v);
      }
    });

    if (Object.keys(visited).length !== nodes().length) {
      throw new Error('Cycle detected');
    }
    return results;
  };


  return {
    to,
    from,
    node,
    nodes,
    sources,
    sinks,
    edge,

    hasNode,
    removeNode,
    addNode,
    addEdge,

    filter,
    dfs,
    dfsNodes,
    topsort,
  };
}

export default createDAG;
