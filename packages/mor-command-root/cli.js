#!/usr/bin/env node
const core = require('mor-core').default;

core
  .config()
  .then(config => {
    console.log(config.rootPath);
  })
  .catch(err => console.log(err));
