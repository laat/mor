import path from 'node:path';

/**
 * Parse a raw.githubusercontent.com URL into filename and repository.
 *
 * Supports:
 *   https://raw.githubusercontent.com/{owner}/{repo}/refs/heads/{branch}/{path}
 *   https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
 */
export function parseRawGitHubUrl(
  url: string,
): { filename: string; repository: string } | undefined {
  const m = url.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)/,
  );
  if (!m) return undefined;
  const [, owner, repo, rest] = m;
  // Strip query params, then extract filename from the remaining path
  const cleanPath = rest.split('?')[0];
  const filename = path.basename(cleanPath);
  return { filename, repository: `github.com/${owner}/${repo}` };
}
