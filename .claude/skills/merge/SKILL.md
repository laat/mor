---
name: merge
description: Merge multiple memories into one, preserving content and updating all cross-references
---

Merge two or more memories into a single consolidated memory.

## Input modes

The user's arguments after `/merge` can be:

1. **IDs** — explicit memory IDs or prefixes: `/merge abc123 def456 ghi789`
2. **Natural language query with filters** — a search query and/or tag/type filters: `/merge all memories tagged nrktv,pipeline` or `/merge pipeline architecture notes`

When the input looks like IDs (8+ hex chars), resolve directly. Otherwise, treat it as a search/filter query.

## Steps

1. **Resolve sources**:
   - **ID mode**: Use `mor read <id>` for each ID. If any doesn't resolve, stop and report.
   - **Query mode**: Use `mor search <query> --tag <tags> --limit 30` (or `mor list --tag <tags>`) to find candidates. Present the results and ask the user to confirm which memories to merge (default: all results). Load full content with `mor read <id>` for each confirmed memory.

2. **Identify backlinks**: For each source memory, run `mor links <id>` to find all other memories that link to it. Collect the full set of memories that will need their links updated (excluding the sources themselves).

3. **Show the user a plan**: Display:
   - The titles of all source memories being merged
   - The number of backlinks that will be updated
   - Ask the user what the **title**, **tags**, **type**, and **description** should be for the merged memory (suggest defaults based on the sources)

4. **Draft merged content**: Combine the content from all sources into a single coherent document. Don't just concatenate — restructure into a unified document:
   - Deduplicate overlapping information
   - Organize by topic with clear headings
   - Preserve all unique details and cross-references to non-source memories
   - Remove any `mor:` links between the source memories (they're being merged into one)

5. **Show the draft** to the user and ask for approval before proceeding.

6. **Create the merged memory**: Run `mor add` with the merged content, title, tags, type, and description.

7. **Update backlinks**: For every memory that linked to any of the source IDs, update its content to replace `mor:<old-source-id>` references with `mor:<new-merged-id>`. Use `mor update <id> --content-file <path>` (write updated content to a temp file). Also update any frontmatter `links` arrays.

8. **Remove sources**: Delete all original source memories with `mor rm <id>`.

9. **Verify**: Run `mor links <new-id>` to confirm the merged memory has the expected backlinks.

## Important

- Always preserve the full information from all sources — merging means consolidating, not summarizing
- Short ID prefixes (8+ hex chars) are fine for `mor` commands
- When updating backlinks in other memories, be careful to replace ALL variants of the source ID (full UUID and short prefix forms)
- If a source memory links to another source memory via `mor:` link, remove that link from the merged content (it would be a self-reference)
