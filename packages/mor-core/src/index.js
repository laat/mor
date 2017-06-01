// @flow
'use strict';
import morWorkspaceModules from 'mor-workspace-modules';
import ModuleGraph from 'mor-module-graph';
import config from './config';
export type { Module } from 'mor-module-graph';

type Opts = {
  cwd?: string,
  strictSemver?: boolean,
  noConfig?: boolean,
};
const defaultOpts = {
  cwd: process.cwd(),
  strictSemver: false,
  noConfig: false,
};
const core = async (providedOpts: ?Opts) => {
  const opts = Object.assign({}, providedOpts, defaultOpts);
  const workspace = await morWorkspaceModules({ cwd: opts.cwd });
  if (workspace == null) {
    throw new Error('Could not find root');
  }
  const modules = await workspace.modules();
  let allModules = [...modules];
  if (workspace && workspace.root) {
    allModules.push(workspace.root);
  }
  const graphWithRoot = new ModuleGraph(allModules, opts.strictSemver);
  const graph = new ModuleGraph(modules, opts.strictSemver);

  const cfg = opts.noConfig ? {} : await config(workspace.root.path);
  return {
    root: workspace.root,
    workspaces: modules || [],
    config: (cfg: Object),
    graph,
    graphWithRoot,
  };
};
core.config = async (providedOpts: ?Opts) => {
  const opts = Object.assign({}, defaultOpts, providedOpts);
  const workspace = await morWorkspaceModules({ cwd: opts.cwd });
  if (workspace == null) {
    throw new Error('Could not find root');
  }
  const cfg = await config(workspace.root.path);
  if (opts.noConfig) {
    return { rootPath: cfg.rootPath };
  }
  return cfg;
};
export default core;
