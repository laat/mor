import { describe, expect, it } from 'vitest';
import { EXT_TO_LANG, LANG_TO_EXT } from './ext.js';

describe('EXT_TO_LANG', () => {
  it('maps common extensions to languages', () => {
    expect(EXT_TO_LANG['.js']).toBe('javascript');
    expect(EXT_TO_LANG['.ts']).toBe('typescript');
    expect(EXT_TO_LANG['.py']).toBe('python');
    expect(EXT_TO_LANG['.rs']).toBe('rust');
  });
});

describe('LANG_TO_EXT', () => {
  it('maps languages to canonical extensions', () => {
    expect(LANG_TO_EXT['javascript']).toBe('.js');
    expect(LANG_TO_EXT['typescript']).toBe('.ts');
    expect(LANG_TO_EXT['yaml']).toBe('.yaml');
    expect(LANG_TO_EXT['bash']).toBe('.sh');
    expect(LANG_TO_EXT['c']).toBe('.c');
    expect(LANG_TO_EXT['cpp']).toBe('.cpp');
    expect(LANG_TO_EXT['r']).toBe('.r');
    expect(LANG_TO_EXT['elixir']).toBe('.ex');
    expect(LANG_TO_EXT['fsharp']).toBe('.fs');
  });

  it('covers every language in EXT_TO_LANG', () => {
    const languages = new Set(Object.values(EXT_TO_LANG));
    for (const lang of languages) {
      expect(LANG_TO_EXT[lang]).toBeDefined();
    }
  });

  it('every value is present as a key in EXT_TO_LANG', () => {
    for (const ext of Object.values(LANG_TO_EXT)) {
      expect(EXT_TO_LANG[ext]).toBeDefined();
    }
  });
});
