// @flow
/* eslint-disable */
export default function rightPad(string: string, length: number, char?: string) {
  let i = -1;
  length = length - string.length;
  if (!char && char !== 0) {
    char = ' ';
  }
  while (++i < length) {
    string += char;
  }

  return string;
}
