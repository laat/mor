var _ = require('lodash');

module.exports = dfs;

function dfs(g, vs, order) {
	if (!_.isArray(vs)) {
		vs = [vs];
	}

	var acc = [];
	var visited = {};
	_.each(vs, function (v) {
		if (!g.hasNode(v)) {
			throw new Error('Graph does not have node: ' + v);
		}

		doDfs(g, v, order === 'post', visited, acc);
	});
	return acc;
}

function doDfs(g, v, postorder, visited, acc) {
	if (!_.has(visited, v)) {
		visited[v] = true;

		if (!postorder) {
			acc.push(v);
		}
		_.each(g.predecessors(v), function (w) {
			doDfs(g, w, postorder, visited, acc);
		});
		if (postorder) {
			acc.push(v);
		}
	}
}
