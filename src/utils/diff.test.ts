import { describe, it, expect } from 'vitest';
import { unifiedDiff } from './diff.js';

describe('unifiedDiff', () => {
  it('returns empty for identical strings', () => {
    expect(unifiedDiff('hello', 'hello')).toBe('');
  });

  it('shows added lines', () => {
    const diff = unifiedDiff('a\nb', 'a\nb\nc');
    expect(diff).toContain('+ c');
  });

  it('shows removed lines', () => {
    const diff = unifiedDiff('a\nb\nc', 'a\nb');
    expect(diff).toContain('- c');
  });

  it('shows changed lines', () => {
    const diff = unifiedDiff('a\nold\nc', 'a\nnew\nc');
    expect(diff).toContain('- old');
    expect(diff).toContain('+ new');
  });

  it('includes context lines', () => {
    const a = 'line1\nline2\nline3\nline4\nline5';
    const b = 'line1\nline2\nchanged\nline4\nline5';
    const diff = unifiedDiff(a, b, 1);
    expect(diff).toContain('  line2');
    expect(diff).toContain('- line3');
    expect(diff).toContain('+ changed');
    expect(diff).toContain('  line4');
  });

  it('returns empty for identical strings with trailing newline', () => {
    expect(unifiedDiff('a\n', 'a\n')).toBe('');
  });

  it('shows added line in newline-terminated files', () => {
    const diff = unifiedDiff('a\n', 'a\nb\n');
    expect(diff).toContain('+ b');
    // No spurious empty context line from the trailing split element
    expect(diff).not.toMatch(/^ {2}$/m);
  });

  it('shows removed line in newline-terminated files', () => {
    const diff = unifiedDiff('a\nb\n', 'a\n');
    expect(diff).toContain('- b');
    expect(diff).not.toMatch(/^ {2}$/m);
  });

  it('separates distant hunks with ...', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const a = lines.join('\n');
    const modified = [...lines];
    modified[2] = 'changed2';
    modified[17] = 'changed17';
    const b = modified.join('\n');
    const diff = unifiedDiff(a, b, 1);
    expect(diff).toContain('...');
  });
});
