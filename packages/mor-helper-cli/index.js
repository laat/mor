const npmRunPath = require('npm-run-path');
const childProcess = require('child_process');

const spawn = (exports.spawn = (
  bin,
  argv,
  { env = process.env, cwd = process.cwd(), opts = {} } = {}
) => {
  try {
    env = Object.assign({}, env, {
      PATH: npmRunPath({ path: process.env.PATH || '', cwd }),
    });
    const proc = childProcess.spawn(
      bin,
      argv,
      Object.assign(
        {
          cwd,
          env,
          stdio: 'inherit',
        },
        opts
      )
    );
    proc.on('close', process.exit.bind(process));
  } catch (err) {
    if (err.code == 'ENOENT') {
      console.error(`\n ${bin} does not exist \n`);
    } else if (err.code == 'EACCES') {
      console.error(
        `\n  ${cliPath} not executable. try chmod or run with root\n`
      );
    }
    console.log('err', err);
    process.exit(1);
  }
});

exports.Program = class SimpleProgram {
  constructor({ name, prettyName }) {
    this.commands = {};
    this.name = name || path.basename(__filename);
    this.prettyName = prettyName || this.name;
  }
  command(name, bin, argv, opts) {
    if (!(argv instanceof Array)) {
      opts = argv || {};
      argv = [];
    }
    const {
      env = process.env,
      cwd = process.cwd(),
      opts: spawnOpts,
    } = opts || {};
    this.commands[name] = { bin, argv, env, cwd, opts: spawnOpts };
    return this;
  }
  parse(argv) {
    const cmd = argv[2];
    const args = argv.slice(3);
    if (cmd == null || cmd === '-h' || cmd === '--help') {
      this.help();
      process.exit(0);
    }
    if (cmd === '') {
      this.help();
      process.exit(0);
    }
    if (this.commands[cmd] == null) {
      console.error(`Command ${cmd} not registered.`);
      process.exit(1);
    }
    const { bin, env, cwd, argv: cmdArgv, opts } = this.commands[cmd];
    spawn(bin, cmdArgv.concat(args), { env, cwd, opts });
  }
  usage() {
    return Object.keys(this.commands)
      .map(cmd => `  ${this.name} ${cmd}`)
      .join('\n');
  }
  help() {
    console.log(`\
${this.prettyName}

Usage:
${this.usage()}
`);
  }
};
