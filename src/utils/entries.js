// @flow
function* entriesGenerator(obj) {
  for (const key of Object.keys(obj)) {
    yield [key, obj[key]];
  }
}
export default function entries(obj: Object) {
  return Array.from(entriesGenerator(obj));
}
