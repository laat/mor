import { describe, it, expect } from 'vitest';
import { matchGlob } from './glob.js';

describe('matchGlob', () => {
  it('matches exact strings', () => {
    expect(matchGlob('typescript', 'typescript')).toBe(true);
    expect(matchGlob('typescript', 'python')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchGlob('TypeScript', 'typescript')).toBe(true);
    expect(matchGlob('typescript', 'TypeScript')).toBe(true);
  });

  it('supports * wildcard', () => {
    expect(matchGlob('typescript', 'type*')).toBe(true);
    expect(matchGlob('typescript', '*script')).toBe(true);
    expect(matchGlob('typescript', '*esc*')).toBe(true);
    expect(matchGlob('typescript', 'python*')).toBe(false);
  });

  it('supports ? wildcard', () => {
    expect(matchGlob('cat', 'c?t')).toBe(true);
    expect(matchGlob('cut', 'c?t')).toBe(true);
    expect(matchGlob('cart', 'c?t')).toBe(false);
  });

  it('escapes regex special chars in pattern', () => {
    expect(matchGlob('file.ts', 'file.ts')).toBe(true);
    expect(matchGlob('filexts', 'file.ts')).toBe(false);
    expect(matchGlob('github.com/laat/mor', 'github.com/laat/*')).toBe(true);
  });
});
