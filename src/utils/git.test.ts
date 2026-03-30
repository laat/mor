import { describe, it, expect } from 'vitest';
import { normalizeGitUrl } from './git.js';

describe('normalizeGitUrl', () => {
  it('normalizes HTTPS URLs', () => {
    expect(normalizeGitUrl('https://github.com/laat/mor.git')).toBe(
      'github.com/laat/mor',
    );
  });

  it('normalizes HTTPS without .git', () => {
    expect(normalizeGitUrl('https://github.com/laat/mor')).toBe(
      'github.com/laat/mor',
    );
  });

  it('normalizes SSH URLs', () => {
    expect(normalizeGitUrl('git@github.com:laat/mor.git')).toBe(
      'github.com/laat/mor',
    );
  });

  it('normalizes SSH without .git', () => {
    expect(normalizeGitUrl('git@github.com:laat/mor')).toBe(
      'github.com/laat/mor',
    );
  });

  it('normalizes HTTP URLs', () => {
    expect(normalizeGitUrl('http://gitlab.example.com/team/repo.git')).toBe(
      'gitlab.example.com/team/repo',
    );
  });

  it('handles SSH with port', () => {
    expect(normalizeGitUrl('git@gitlab.com:2222:org/repo.git')).toBe(
      'gitlab.com/org/repo',
    );
  });
});
