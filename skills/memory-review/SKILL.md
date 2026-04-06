---
name: memory-review
description: Review the memory store for quality issues — duplicates, stale content, broken links, tag inconsistencies, and cleanup opportunities
---

Audit the memory store and produce a structured report of proposed changes. Do NOT apply changes — present proposals for user approval, then use `/memory-consolidate` or individual `memory_update`/`memory_remove` calls to execute approved changes.

## Examples

```
/memory-review
/memory-review tag hygiene
/memory-review duplicates
/memory-review stale
```

## Steps

### 1. Gather the full picture

- `memory_list` with a high limit to get all memories
- Aggregate tag and type distributions from the full list (count occurrences across all memories)
- Note total count, tag distribution, type distribution

**Success criteria**: You have a complete inventory of all memories with their metadata.

### 2. Read and classify

Read memories in batches using `memory_read` (batch IDs). For each memory, check:

| Issue                   | What to look for                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| **Duplicates**          | Memories with very similar titles or overlapping content                                        |
| **Stale**               | Outdated information, references to things that may have changed                                |
| **Tag inconsistencies** | Similar tags that should be unified (e.g. "fs" vs "filesystem"), unused tags on single memories |
| **Type mismatches**     | Memories whose type doesn't match their content (see type guidelines below)                     |
| **Broken links**        | `mor:` links pointing to non-existent memories                                                  |
| **Missing links**       | Memories that reference the same concepts but aren't cross-linked                               |
| **Empty/thin**          | Memories with very little content that could be merged into related notes                       |
| **Title quality**       | Vague titles that don't help with search                                                        |

### Type guidelines

- **`file`** — a source file that can be dropped into a project as-is. Content should be a brief one-line description followed by a single fenced code block — nothing else. No prose sections, no multiple code blocks. If a file memory has extra context (usage examples, design notes), split those into a separate `snippet` or `knowledge` memory with a cross-reference link.
- **`snippet`** — a code example, pattern, or recipe. Can have prose, multiple code blocks, and explanatory sections.
- **`knowledge`** — concepts, design docs, references. Primarily prose.

If the user specified a focus area (e.g. "duplicates", "tag hygiene"), prioritize that.

**Success criteria**: Each memory has been reviewed and issues catalogued.

### 3. Present the report

Output a structured report grouped by issue type:

1. **Duplicates** — groups of memories that overlap, with merge suggestions
2. **Tag cleanup** — tags to rename/unify, with affected memories
3. **Stale content** — memories that may need updating or removal
4. **Broken links** — dangling `mor:` references
5. **Missing links** — suggested cross-references between related memories
6. **Other** — type mismatches, thin notes, title improvements

For each proposal, include:

- The memory ID(s) and title(s)
- What the issue is
- Suggested action (merge, retag, update, remove, link)

End with a summary: "X memories reviewed, Y issues found across Z categories"

**Success criteria**: User can review and approve/reject each proposal individually.

### 4. Execute approved changes

After the user approves specific proposals:

- Use `memory_update` for retags, title changes, content updates
- Use `/memory-consolidate` for batch operations (retagging many notes, merging)
- Use `memory_remove` for deletions
- Report what was changed

## Rules

- Present ALL proposals before making any changes
- Do NOT modify or delete memories without explicit user approval
- Be conservative — flag uncertain issues as "possible" rather than definitive
- For large stores (50+), focus on the highest-impact issues first
- Short ID prefixes (8+ hex chars) work for all `mor` commands and links
