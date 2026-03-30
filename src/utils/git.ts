export function normalizeGitUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/\.git$/, '')
    .replace(/:(\d+:)?/, '/');
}
