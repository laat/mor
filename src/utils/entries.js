function* entriesGenerator(obj) {
   for (let key of Object.keys(obj)) {
     yield [key, obj[key]];
   }
}
export default function entries(obj) {
  return Array.from(entriesGenerator(obj));
}
