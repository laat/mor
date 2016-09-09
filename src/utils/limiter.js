// @flow
function createTask(thunk) {
  const task = {};
  if (!thunk) {
    throw new Error('a thunk is required');
  }
  if (typeof thunk !== 'function') {
    throw new Error('the thunk must be a function');
  }

  task.thunk = thunk;

  task.promise = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });
  return task;
}

function limiter(max: number = 1) {
  let running = 0;

  const tasks = [];
  function runNext() {
    if (running >= max) {
      return;
    }
    const task = tasks.shift();
    if (!task) {
      return;
    }

    running++;
    const p = Promise.resolve(task.thunk());
    p.then(res => {
      running--;
      task.resolve(res);
      runNext();
    }).catch(err => {
      running--;
      task.reject(err);
      runNext();
    });
  }

  function run(cb: Function) {
    const task = createTask(cb);
    tasks.push(task);
    runNext();
    return task.promise;
  }

  return {
    run,
  };
}

export default limiter;

// const delay = (i) => () => new Promise(resolve => {
//   setTimeout(resolve, i, i);
// });

// const limit = limiter(2);
// limit.run(delay(1000)).then((r) => console.log(r));
// limit.run(delay(1001)).then((r) => console.log(r));
// limit.run(delay(1002)).then((r) => console.log(r));
// limit.run(delay(1003)).then((r) => console.log(r));
// limit.run(delay(1004)).then((r) => console.log(r));
// limit.run(delay(1005)).then((r) => console.log(r));
