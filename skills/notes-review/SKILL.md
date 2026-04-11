---
name: notes-review
description: Review the note store for quality issues — duplicates, stale content, broken links, tag inconsistencies, and cleanup opportunities
---

Audit the note store and produce a structured report of proposed changes. Do NOT apply changes — present proposals for user approval, then use `/notes-consolidate` or individual `notes_update`/`notes_remove` calls to execute approved changes.

## Examples

```
/notes-review
/notes-review tag hygiene
/notes-review duplicates
/notes-review stale
```

## Steps

### 1. Gather the full picture

- `notes_list` with a high limit to get all notes
- Aggregate tag and type distributions from the full list (count occurrences across all notes)
- Note total count, tag distribution, type distribution

**Success criteria**: You have a complete inventory of all notes with their metadata.

### 2. Read and classify

Read notes in batches using `notes_read` (batch IDs). For each note, check:

| Issue                   | What to look for                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Duplicates**          | Notes with very similar titles or overlapping content                                        |
| **Stale**               | Outdated information, references to things that may have changed                             |
| **Tag inconsistencies** | Similar tags that should be unified (e.g. "fs" vs "filesystem"), unused tags on single notes |
| **Type mismatches**     | Notes whose type doesn't match their content (see type guidelines below)                     |
| **Broken links**        | `mor:` links pointing to non-existent notes                                                  |
| **Missing links**       | Notes that reference the same concepts but aren't cross-linked                               |
| **Empty/thin**          | Notes with very little content that could be merged into related notes                       |
| **Title quality**       | Vague titles that don't help with search                                                     |

### Type guidelines

- **`file`** — a source file that can be dropped into a project as-is. Content should be a brief one-line description followed by a single fenced code block — nothing else. No prose sections, no multiple code blocks. If a file note has extra context (usage examples, design notes), split those into a separate `snippet` or `knowledge` note with a cross-reference link.
- **`snippet`** — a code example, pattern, or recipe. Can have prose, multiple code blocks, and explanatory sections.
- **`knowledge`** — concepts, design docs, references. Primarily prose.

If the user specified a focus area (e.g. "duplicates", "tag hygiene"), prioritize that.

**Success criteria**: Each note has been reviewed and issues catalogued.

### 3. Present the report

Output a structured report grouped by issue type:

1. **Duplicates** — groups of notes that overlap, with merge suggestions
2. **Tag cleanup** — tags to rename/unify, with affected notes
3. **Stale content** — notes that may need updating or removal
4. **Broken links** — dangling `mor:` references
5. **Missing links** — suggested cross-references between related notes
6. **Other** — type mismatches, thin notes, title improvements

For each proposal, include:

- The note ID(s) and title(s)
- What the issue is
- Suggested action (merge, retag, update, remove, link)

End with a summary: "X notes reviewed, Y issues found across Z categories"

**Success criteria**: User can review and approve/reject each proposal individually.

### 4. Execute approved changes

After the user approves specific proposals:

- Use `notes_update` for retags, title changes, content updates
- Use `/notes-consolidate` for batch operations (retagging many notes, merging)
- Use `notes_remove` for deletions
- Report what was changed

## Rules

- Present ALL proposals before making any changes
- Do NOT modify or delete notes without explicit user approval
- Be conservative — flag uncertain issues as "possible" rather than definitive
- For large stores (50+), focus on the highest-impact issues first
- Short ID prefixes (8+ hex chars) work for all `mor` commands and links
