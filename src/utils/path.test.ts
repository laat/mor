import { describe, it, expect } from 'vitest';
import { expandHome } from './path.js';

describe('expandHome', () => {
  it('expands ~/ to HOME', () => {
    const result = expandHome('~/documents');
    expect(result).toBe(`${process.env.HOME}/documents`);
  });

  it('expands bare ~', () => {
    const result = expandHome('~');
    expect(result).toBe(process.env.HOME);
  });

  it('does not expand paths without ~', () => {
    expect(expandHome('/usr/local')).toBe('/usr/local');
    expect(expandHome('relative/path')).toBe('relative/path');
  });

  it('does not expand ~ in the middle', () => {
    expect(expandHome('/home/~user')).toBe('/home/~user');
  });
});
