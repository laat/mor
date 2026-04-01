import { describe, it, expect } from 'vitest';
import { wrapCodeFence, stripCodeFence } from './markdown.js';

describe('wrapCodeFence', () => {
  it('wraps a .ts file in a typescript fence', () => {
    expect(wrapCodeFence('const x = 1;\n', 'index.ts')).toBe(
      '```typescript\nconst x = 1;\n```',
    );
  });

  it('wraps a .py file in a python fence', () => {
    expect(wrapCodeFence('x = 1\n', 'main.py')).toBe('```python\nx = 1\n```');
  });

  it('uses extension as lang when not in EXT_TO_LANG', () => {
    expect(wrapCodeFence('code\n', 'file.zig')).toBe('```zig\ncode\n```');
  });

  it('returns markdown files as-is', () => {
    expect(wrapCodeFence('# Hello\n', 'README.md')).toBe('# Hello\n');
  });

  it('returns .txt files as-is', () => {
    expect(wrapCodeFence('plain text\n', 'notes.txt')).toBe('plain text\n');
  });

  it('returns extensionless files as-is', () => {
    expect(wrapCodeFence('content\n', 'Makefile')).toBe('content\n');
  });

  it('strips trailing newline before closing fence', () => {
    expect(wrapCodeFence('line1\nline2\n', 'a.js')).toBe(
      '```javascript\nline1\nline2\n```',
    );
  });
});

describe('stripCodeFence', () => {
  it('extracts code and lang from a fenced block', () => {
    expect(stripCodeFence('```typescript\nconst x = 1;\n```')).toEqual({
      code: 'const x = 1;',
      lang: 'typescript',
    });
  });

  it('handles blocks with no language', () => {
    expect(stripCodeFence('```\nhello\n```')).toEqual({
      code: 'hello',
      lang: '',
    });
  });

  it('returns null for plain text', () => {
    expect(stripCodeFence('just some text')).toBeNull();
  });

  it('returns null for content with text outside fence', () => {
    expect(stripCodeFence('before\n```js\ncode\n```')).toBeNull();
  });

  it('handles multiline code', () => {
    const input = '```python\ndef foo():\n    return 42\n```';
    expect(stripCodeFence(input)).toEqual({
      code: 'def foo():\n    return 42',
      lang: 'python',
    });
  });
});
