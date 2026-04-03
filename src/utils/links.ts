/**
 * Extract link IDs from a memory document.
 *
 * Two sources:
 * 1. Markdown links with `mor:` URLs: `[text](mor:<id>)`
 * 2. Frontmatter `links` array: `[{ id, title }]`
 *
 * Returns deduplicated array of raw IDs (short or full UUIDs).
 */

const MARKDOWN_LINK_RE = /\]\(mor:([0-9a-f-]{8,36})\)/gi;
const FENCED_CODE_RE = /^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm;

function stripCodeFences(text: string): string {
  return text.replace(FENCED_CODE_RE, '');
}

export interface FrontmatterLink {
  id: string;
  title: string;
}

export function extractLinkIds(
  content: string,
  frontmatterLinks?: FrontmatterLink[],
): string[] {
  const ids = new Set<string>();

  for (const match of stripCodeFences(content).matchAll(MARKDOWN_LINK_RE)) {
    ids.add(match[1].toLowerCase());
  }

  if (frontmatterLinks) {
    for (const link of frontmatterLinks) {
      if (link.id) ids.add(link.id.toLowerCase());
    }
  }

  return [...ids];
}

export function parseFrontmatterLinks(
  data: Record<string, unknown>,
): FrontmatterLink[] | undefined {
  const links = data.links;
  if (!Array.isArray(links)) return undefined;
  const result: FrontmatterLink[] = [];
  for (const item of links) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).id === 'string'
    ) {
      const obj = item as Record<string, unknown>;
      result.push({
        id: obj.id as string,
        title: typeof obj.title === 'string' ? obj.title : '',
      });
    }
  }
  return result.length > 0 ? result : undefined;
}
