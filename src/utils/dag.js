/* eslint-disable no-underscore-dangle, no-prototype-builtins */
// @flow
export type OrderedCallback = {
    (v: string, callback: any): void;
}

export type DAG<T> = {
    to(v: string): string[];
    from(v: string): string[];
    nodes(): string[];
    sources(): string[];
    sinks(): string[];
    node(v: string): T;
    addNode(v: string, value?: any): void;
    removeNode(v: string): void;
    hasNode(v: string): void;
    edge(v: string, w: string): string;
    addEdge(v: string, w: string, label: ?string): void;
    filter(filterFunction: (v: string) => boolean): DAG<T>;
    orderedCallbacks(cb: OrderedCallback): void;
    topsort(): string[];
    dfs(startNode: string, backwards?: boolean): string[];
    dfsNodes(nodes: string[], backwards?: boolean): string[];
}

export default function create<T>(): DAG<T> {
  const _nodes = {};
  const _to = {};
  const _from = {};

  const to = (v: string) => Object.keys(_to[v] || {});
  const from = (v: string) => Object.keys(_from[v] || {});
  const nodes = (): string[] => Object.keys(_nodes);
  const sources = (): string[] => nodes().filter(v => to(v).length === 0);
  const sinks = (): string[] => nodes().filter(v => from(v).length === 0);
  const node = (v: string) => _nodes[v];

  const addNode = function addNode(v: string, value: ?any) {
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

  const hasNode = (v: string) => _nodes.hasOwnProperty(v);
  const edge = (v: string, w: string) => _from[v][w];

  const addEdge = function addEdge(v: string, w: string, label: ?string) {
    if (!hasNode(v)) {
      addNode(v);
    }
    if (!hasNode(w)) {
      addNode(w);
    }
    _to[w][v] = label;
    _from[v][w] = label;
  };

  const filter = function filter(filterFunction: (v: string) => boolean) {
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

  const orderedCallbacks = function orderedCallbacks(cb: OrderedCallback) {
    const counts = nodes()
            .reduce((sum, v) => {
              sum[v] = from(v).length; //eslint-disable-line
              return sum;
            }, {});

    function visit(v: string) {
      cb(v, () => {
        to(v).forEach((w) => {
          if (--counts[w] === 0) {
            visit(w);
          }
        });
      });
    }

    nodes().forEach((v) => {
      if (counts[v] === 0) {
        visit(v);
      }
    });
  };

  const topsort = function topsort() {
    const visited: {[key: string]: boolean} = {};
    const stack: {[key: string]: boolean} = {};
    const results: string[] = [];

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


  const dfs = function dfs(startNode: string, backwards?: boolean) {
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

  const dfsNodes = function dfsNodes(searchNodes: string[], backwards?: boolean): string[] {
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
    orderedCallbacks,
    topsort,
    dfs,
    dfsNodes,
  };
}
