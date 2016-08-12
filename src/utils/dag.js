/* eslint-disable no-underscore-dangle, no-prototype-builtins */
export default function create() {
  const _nodes = {};
  const _to = {};
  const _from = {};

  const to = (v) => Object.keys(_to[v] || {});
  const from = (v) => Object.keys(_from[v] || {});
  const nodes = () => Object.keys(_nodes);
  const sources = () => nodes().filter(v => to(v).length === 0);
  const sinks = () => nodes().filter(v => from(v).length === 0);
  const node = (v) => _nodes[v];

  const addNode = function addNode(v, value) {
    _nodes[v] = value;
    _to[v] = _to[v] || {};
    _from[v] = _from[v] || {};
  };

  const removeNode = function removeNode(v: string) {
    to(v).forEach((w) => delete _from[w][v]);
    from(v).forEach((w) => delete _to[w][v]);
    delete _nodes[v];
    delete _to[v];
    delete _from[v];
  };

  const hasNode = (v) => _nodes.hasOwnProperty(v);
  const edge = (v, w) => _from[v][w];

  const addEdge = function addEdge(v, w, label) {
    if (!hasNode(v)) {
      addNode(v);
    }
    if (!hasNode(w)) {
      addNode(w);
    }
    _to[w][v] = label;
    _from[v][w] = label;
  };

  const filter = function filter(filterFunction) {
    const filtered = create();
    nodes().forEach(v => {
      if (filterFunction(v)) {
        filtered.addNode(v, node(v));
      }
    });
    filtered.nodes().forEach((v: string) => {
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
    const result: string[] = [];
    function dfsNode(v: string, backwards?: boolean) { // eslint-disable-line no-shadow
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

  const dfsNodes = function dfsNodes(searchNodes, backwards): string[] {
    const included: string[] = [];
    searchNodes.forEach((name) => {
      dfs(name, backwards).forEach((pre) => {
        included.push(pre);
      });
    });
    return included;
  };

  return {
    to,
    from,
    nodes,
    sources,
    sinks,
    node,
    addNode,
    removeNode,
    hasNode,
    edge,
    addEdge,
    filter,
    dfs,
    dfsNodes,
  };
}
