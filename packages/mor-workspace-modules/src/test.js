/* eslint-env jest */
// @flow
'use strict';
const path = require('path');
const test = require('tape-promise/tape');
const findModules = require('.').default;

test('should find workspaces in root like yarn', async assert => {
  const fixtureRoot = path.join(__dirname, '__test__', 'yarn');
  const m = (await findModules({ cwd: fixtureRoot })) || {};

  const modules = (await m.modules()) || [];
  const root: any = m.root || {};

  assert.equals(root.pkg.name, 'yarn-root', 'correct root');
  assert.equals(modules.length, 1, 'finds the package');
  assert.equals(
    modules[0].path,
    path.join(fixtureRoot, 'packages', 'foobar', 'package.json'),
    'has correct path'
  );
  assert.equals(modules[0].pkg.name, 'foobar', 'with correct package.json');

  assert.equals(root.path, path.join(fixtureRoot, 'package.json'));
});

test('should find workspaces in workspace like yarn', async assert => {
  const fixtureRoot = path.join(__dirname, '__test__', 'yarn');
  const workspaceRoot = path.join(
    fixtureRoot,
    'packages',
    'foobar',
    'package.json'
  );

  const m = (await findModules({ cwd: workspaceRoot })) || {};
  const modules = (await m.modules()) || [];
  const root: any = m.root || {};
  assert.equals(root.pkg.name, 'yarn-root', 'correct root');
  assert.equals(modules.length, 1, 'finds the package');
  assert.equals(modules[0].path, workspaceRoot, 'has correct path');
  assert.equals(modules[0].pkg.name, 'foobar', 'with correct package.json');

  assert.equals(root.path, path.join(fixtureRoot, 'package.json'));
});

test('should find workspaces in root like yarn', async assert => {
  const fixtureRoot = path.join(__dirname, '__test__', 'yarn');
  const m = (await findModules({ cwd: fixtureRoot })) || {};

  const modules = (await m.modules()) || [];
  const root: any = m.root || {};

  assert.equals(root.pkg.name, 'yarn-root', 'correct root');
  assert.equals(modules.length, 1, 'finds the package');
  assert.equals(
    modules[0].path,
    path.join(fixtureRoot, 'packages', 'foobar', 'package.json'),
    'has correct path'
  );
  assert.equals(modules[0].pkg.name, 'foobar', 'with correct package.json');

  assert.equals(root.path, path.join(fixtureRoot, 'package.json'));
});

test('should find workspaces in workspace like lerna', async assert => {
  const fixtureRoot = path.join(__dirname, '__test__', 'lerna');
  const workspaceRoot = path.join(
    fixtureRoot,
    'packages',
    'foobar',
    'package.json'
  );

  const m = (await findModules({ cwd: workspaceRoot })) || {};
  const modules = (await m.modules()) || [];
  const root: any = m.root || {};
  assert.equals(root.pkg.name, 'lerna-root', 'correct root');
  assert.equals(modules.length, 1, 'finds the package');
  assert.equals(modules[0].path, workspaceRoot, 'has correct path');
  assert.equals(modules[0].pkg.name, 'foobar', 'with correct package.json');

  assert.equals(root.path, path.join(fixtureRoot, 'package.json'));
});

test('should find workspaces in root like lerna', async assert => {
  const fixtureRoot = path.join(__dirname, '__test__', 'lerna');
  const m = (await findModules({ cwd: fixtureRoot })) || {};

  const modules = (await m.modules()) || [];
  const root: any = m.root || {};

  assert.equals(root.pkg.name, 'lerna-root', 'correct root');
  assert.equals(modules.length, 1, 'finds the package');
  assert.equals(
    modules[0].path,
    path.join(fixtureRoot, 'packages', 'foobar', 'package.json'),
    'has correct path'
  );
  assert.equals(modules[0].pkg.name, 'foobar', 'with correct package.json');

  assert.equals(root.path, path.join(fixtureRoot, 'package.json'));
});
