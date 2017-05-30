// @flow
import core from '.';

(async () => {
  try {
    const mor = await core();
    console.log({ mor });
    console.log({ deps: mor.graph.dependents('mor-graph') });
    console.log({
      tdeps: mor.graph.dependents('mor-graph', { transitive: true }),
    });
    console.log({ deps: mor.graph.dependencies('mor-core') });
    console.log({
      tdeps: mor.graph.dependencies('mor-core', { transitive: true }),
    });
    console.log('\n\n\n\n');
    await core();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
