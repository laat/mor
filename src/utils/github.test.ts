import { describe, it, expect } from 'vitest';
import { parseRawGitHubUrl } from './github.js';

describe('parseRawGitHubUrl', () => {
  it('parses a refs/heads URL', () => {
    const result = parseRawGitHubUrl(
      'https://raw.githubusercontent.com/owner/repo/refs/heads/main/src/index.ts',
    );
    expect(result).toEqual({
      filename: 'index.ts',
      repository: 'github.com/owner/repo',
    });
  });

  it('parses a short ref URL', () => {
    const result = parseRawGitHubUrl(
      'https://raw.githubusercontent.com/owner/repo/abc123/lib/utils.js',
    );
    expect(result).toEqual({
      filename: 'utils.js',
      repository: 'github.com/owner/repo',
    });
  });

  it('strips query params', () => {
    const result = parseRawGitHubUrl(
      'https://raw.githubusercontent.com/owner/repo/main/file.ts?token=abc',
    );
    expect(result).toEqual({
      filename: 'file.ts',
      repository: 'github.com/owner/repo',
    });
  });

  it('returns undefined for non-GitHub URLs', () => {
    expect(parseRawGitHubUrl('https://example.com/file.ts')).toBeUndefined();
  });

  it('returns undefined for regular GitHub URLs', () => {
    expect(
      parseRawGitHubUrl('https://github.com/owner/repo/blob/main/file.ts'),
    ).toBeUndefined();
  });
});
