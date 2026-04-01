import { describe, it, expect } from 'vitest';
import { ANSI_RE, ANSI_START_RE, truncate } from './ansi.js';

describe('ANSI_RE', () => {
  it('matches ANSI escape sequences', () => {
    expect('hello \x1b[31mworld\x1b[0m'.replace(ANSI_RE, '')).toBe(
      'hello world',
    );
  });

  it('does not match plain text', () => {
    expect('hello world'.replace(ANSI_RE, '')).toBe('hello world');
  });
});

describe('ANSI_START_RE', () => {
  it('matches ANSI at start of string', () => {
    expect(ANSI_START_RE.test('\x1b[31mhello')).toBe(true);
  });

  it('does not match ANSI in middle of string', () => {
    expect(ANSI_START_RE.test('hello\x1b[31m')).toBe(false);
  });
});

describe('truncate', () => {
  it('returns line as-is when shorter than cols', () => {
    expect(truncate('hello', 80)).toBe('hello');
  });

  it('returns line as-is when cols is 0', () => {
    expect(truncate('hello', 0)).toBe('hello');
  });

  it('truncates plain text with ellipsis', () => {
    const result = truncate('abcdefghij', 5);
    expect(result).toBe('abcd\x1b[0m…');
  });

  it('preserves ANSI codes and truncates by visible width', () => {
    // 10 visible chars with ANSI color
    const input = '\x1b[31mabcdefghij\x1b[0m';
    const result = truncate(input, 5);
    // Should have 4 visible chars + reset + ellipsis
    expect(result).toBe('\x1b[31mabcd\x1b[0m…');
  });

  it('does not truncate when visible length equals cols', () => {
    const input = '\x1b[31mabcde\x1b[0m';
    const result = truncate(input, 5);
    expect(result).toBe(input);
  });

  it('handles string with multiple ANSI sequences', () => {
    const input = '\x1b[31mab\x1b[32mcd\x1b[0mefghij';
    const result = truncate(input, 6);
    // 5 visible chars fit in cols-1
    expect(result.replace(ANSI_RE, '').replace('…', '')).toBe('abcde');
  });
});
