import { describe, it, expect } from 'vitest';
import { extractLinkIds, parseFrontmatterLinks } from './links.js';

describe('extractLinkIds', () => {
  it('extracts IDs from markdown links', () => {
    const content =
      'See [my note](mor:70008775) and [other](mor:3f4e5a12-abcd-1234-5678-abcdef012345).';
    const ids = extractLinkIds(content);
    expect(ids).toContain('70008775');
    expect(ids).toContain('3f4e5a12-abcd-1234-5678-abcdef012345');
  });

  it('ignores bare mor: references', () => {
    const content = 'See mor:70008775 for details.';
    const ids = extractLinkIds(content);
    expect(ids).toHaveLength(0);
  });

  it('deduplicates IDs', () => {
    const content =
      '[a](mor:70008775) and [b](mor:70008775) reference the same note.';
    const ids = extractLinkIds(content);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe('70008775');
  });

  it('merges frontmatter links', () => {
    const content = '[inline](mor:aaaaaaaa)';
    const fmLinks = [
      { id: 'bbbbbbbb', title: 'Other Note' },
      { id: 'aaaaaaaa', title: 'Duplicate' },
    ];
    const ids = extractLinkIds(content, fmLinks);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('aaaaaaaa');
    expect(ids).toContain('bbbbbbbb');
  });

  it('returns empty for no links', () => {
    expect(extractLinkIds('no links here')).toHaveLength(0);
  });

  it('lowercases IDs', () => {
    const content = '[note](mor:AABBCCDD)';
    const ids = extractLinkIds(content);
    expect(ids[0]).toBe('aabbccdd');
  });
});

describe('parseFrontmatterLinks', () => {
  it('parses valid links array', () => {
    const data = {
      links: [
        { id: '70008775', title: 'Note A' },
        { id: '3f4e5a12', title: 'Note B' },
      ],
    };
    const result = parseFrontmatterLinks(data);
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ id: '70008775', title: 'Note A' });
  });

  it('returns undefined for missing links', () => {
    expect(parseFrontmatterLinks({})).toBeUndefined();
  });

  it('returns undefined for non-array links', () => {
    expect(parseFrontmatterLinks({ links: 'not an array' })).toBeUndefined();
  });

  it('skips items without id', () => {
    const data = {
      links: [
        { id: '70008775', title: 'Valid' },
        { title: 'Missing ID' },
        'bare string',
      ],
    };
    const result = parseFrontmatterLinks(data);
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('70008775');
  });

  it('handles missing title', () => {
    const data = { links: [{ id: '70008775' }] };
    const result = parseFrontmatterLinks(data);
    expect(result).toHaveLength(1);
    expect(result![0].title).toBe('');
  });
});
