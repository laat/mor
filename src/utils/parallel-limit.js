// @flow

export default function parallelLimit(tasks: Array<() => Promise<*>>, limit: number = 1) {
  if (tasks.length === 0) {
    return Promise.resolve([]);
  }

  const iterator = tasks.entries();
  return new Promise((resolve, reject) => {
    const results = [];
    let running = 0;
    let rejectReason;
    function execNext() {
      if (running >= limit) {
        return;
      }
      if (rejectReason) {
        if (running === 0) {
          reject(rejectReason);
        }
        return;
      }
      const { value, done } = iterator.next();
      if (done) {
        if (!running) {
          resolve(results);
        } else {
          return;
        }
      }
      if (value != null) {
        const [i, task] = value;
        running++;
        task()
          .then(result => {
            results[i] = result;
            running--;
            execNext();
          }, (err) => {
            rejectReason = err;
            if(--running === 0) {
              reject(rejectReason);
            }
          });
        if (running < limit) {
          execNext();
        }
      }
    }
    execNext();
  });
}

// const delay = (i) => () => new Promise(resolve => {
//   setTimeout(resolve, i, i);
// });
//
// parallelLimit([
//   delay(1000),
//   delay(100),
//   delay(200),
//   delay(400),
//   delay(100),
// ]).then(res => console.log(res));
