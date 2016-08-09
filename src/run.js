import { spawn, execSync } from 'child_process';

export function run(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      env: process.env,
      stdio: 'inherit',
      cwd: process.cwd,
      shell: true,
    });
    child.on('close', code => {
      if (code !== 0) {
        const err = new Error(`'${cmd}' exited with code ${code}`);
        err.code = code;
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export function runSync(cmd, cwd) {
  return execSync(cmd, { shell: true, stdio: [0, 1, 2], cwd });
}

// runSync('npm installi')
// run('npm installi').then(() => console.log('all done')).catch((err) => console.error(err));
