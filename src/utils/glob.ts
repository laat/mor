export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${withWildcards}$`, 'i');
}

const regexCache = new Map<string, RegExp>();

export function matchGlob(value: string, pattern: string): boolean {
  let re = regexCache.get(pattern);
  if (!re) {
    re = globToRegex(pattern);
    if (regexCache.size >= 64) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return re.test(value);
}
