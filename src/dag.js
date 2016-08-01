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

export default function create<T> (): DAG<T> {
    const _nodes = {};
    const _to = {};
    const _from = {};

    const to = function (v: string) {
        return Object.keys(_to[v] || {});
    };

    const from = function (v: string) {
        return Object.keys(_from[v] || {});
    };

    const nodes = function (): string[] {
        return Object.keys(_nodes);
    };

    const sources = function (): string[] {
        return nodes().filter(v => to(v).length === 0);
    };

    const sinks = function (): string[] {
        return nodes().filter(v => from(v).length === 0);
    };

    const node = function (v: string) {
        return _nodes[v];
    };

    const addNode = function (v: string, value?: any) {
        _nodes[v] = value;
        _to[v] = _to[v] || {};
        _from[v] = _from[v] || {};
    };

    const removeNode = function (v: string) {
        to(v).forEach((w) => delete _from[w][v]);
        from(v).forEach((w) => delete _to[w][v]);
        delete _nodes[v];
        delete _to[v];
        delete _from[v];
    };

    const hasNode = function (v: string) {
        return _nodes.hasOwnProperty(v);
    };

    const edge = function (v: string, w: string) {
        return _from[v][w];
    };

    const addEdge = function (v: string, w: string, label: ?string) {
        if (!hasNode(v)) {
            addNode(v);
        }
        if (!hasNode(w)) {
            addNode(w);
        }
        _to[w][v] = label;
        _from[v][w] = label;
    };

    const filter = function (filterFunction: (v: string) => boolean ) {
        let filtered = create();
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
                };
            });
        });
        return filtered;
    };

    const orderedCallbacks = function (cb: OrderedCallback) {
        let counts = nodes()
            .reduce((sum, v) => {
                sum[v] = from(v).length;
                return sum;
            }, {});

        function visit (v: string) {
            cb(v, () => {
                to(v).forEach(function (w) {
                    if (--counts[w] === 0) {
                        visit(w);
                    }
                });
            });
        }

        nodes().forEach(function (v) {
            if (counts[v] === 0) {
                visit(v);
            }
        });
    };

    const topsort = function () {
        let visited: {[key: string]: boolean} = {};
        let stack: {[key: string]: boolean} = {};
        let results: string[] = [];

        sinks().forEach(function visit (v) {
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


    const dfs = function (startNode: string, backwards?: boolean) {
        let visited: {[key: string]: boolean} = {};
        let result: string[] = [];
        function dfs (v: string, backwards?: boolean) {
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
                    dfs(w, backwards);
                }
            });
        }
        dfs(startNode, backwards);
        return result;
    };

    const dfsNodes = function (nodes: string[], backwards?: boolean): string[] {
        let included: string[] = [];
        nodes.forEach((name) => {
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
        dfsNodes
    };
}
