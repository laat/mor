# locate workspace modules the same way as Yarn
[issue 3294](https://github.com/yarnpkg/yarn/issues/3294)

![](screenshot.gif)
```sh
project root
├── package.json <-- root config with 'workspaces' property
├── packages
│   └── foobar
│       ├── node_modules <-- ignored by default
│       │   └── foobar2
│       │       └── package.json
│       └── package.json <-- included
└── readme.md

4 directories, 4 files
```

## TODO
### mor-config
```js
{
  rootPath,
  workspaces,
  // keep next?
  ignore, // optional array of ignore-patterns, defaults to ['**/node_modules/*']
  cli // optional, if set use this cli instead of the default implementation
}
```

### mor-cli
```
mor [--no-config]
mor --no-config ls
mor --no-config run
mor --no-config exec
mor --no-config test
```
### mor-command-lsdot
### mor-command-cycles
### mor-command-nsp
> checks packages with nsp

hoisting f**s this up?
### mor-command-bootstrap
### mor-command-root
```
root
root run test
root eslint
root lerna bootstrap
```

### mor-command-hasdep
```
hasdep [--prod] [--dev] foobar
hasdep [--prod] [--dev] foobar@^2.0
```

### mor-helpers
> Collection of helper functions used by mor commands.

### mor-helper-filter-name
### mor-helper-filter-scope
### mor-helper-filter-hasdep
> has external depenendency

### mor-helper-bootstrap
> Until yarn fixes this
### mor-helper-module-link
> Until yarn fixes this
### mor-helper-dot
### mor-helper-dot-browser
### mor-helper-ascii
### mor-helper-table
