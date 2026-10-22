import { describe, it, expect } from 'vitest';
import { parseArchivedSyntax } from './query.js';

describe('parseArchivedSyntax', () => {
  it('leaves a query without operators untouched', () => {
    expect(parseArchivedSyntax('python  naming')).toEqual({
      query: 'python  naming',
    });
  });

  it('reads is:archived as only', () => {
    expect(parseArchivedSyntax('is:archived python')).toEqual({
      query: 'python',
      archived: 'only',
    });
  });

  it('reads archived:<mode>', () => {
    expect(parseArchivedSyntax('python archived:include')).toEqual({
      query: 'python',
      archived: 'include',
    });
    expect(parseArchivedSyntax('archived:only')).toEqual({
      query: '',
      archived: 'only',
    });
    expect(parseArchivedSyntax('ARCHIVED:Exclude x')).toEqual({
      query: 'x',
      archived: 'exclude',
    });
  });

  it('keeps unknown modes as search words', () => {
    expect(parseArchivedSyntax('archived:maybe')).toEqual({
      query: 'archived:maybe',
    });
  });
});
