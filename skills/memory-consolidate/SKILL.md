---
name: memory-consolidate
description: Apply batch edits to memories using natural language — rename, retag, add cross-references, merge, or clean up a set of notes
---

Apply a natural language instruction across a set of memories, handling cross-reference updates automatically.

## Examples

```
/memory-consolidate all pipeline notes should have Pipeline prefix in title
/memory-consolidate normalize fsharp tags — use "fsharp" not "f#"
/memory-consolidate add cross-references between related pipeline notes
/memory-consolidate merge the two ID model notes into one
/memory-consolidate remove the todo tag from completed items
```

## Steps

1. **Parse the instruction**: Identify:
   - **Scope** — which memories to target (tag filter, search query, explicit IDs, or "all")
   - **Action** — what to do (rename, retag, add links, merge, update content, delete)

2. **Find target memories**: Use `mor` MCP tools to find the memories:
   - `memory_list` with tag/type filters for broad scopes
   - `memory_search` for query-based scopes
   - `memory_read` for explicit IDs

   Read each target memory's full content to understand what changes are needed.

3. **Plan changes**: For each target memory, determine what needs to change. Present the plan to the user:
   - List each memory and what will change (title, tags, content, etc.)
   - If merging: show which notes combine and which get deleted
   - If adding cross-references: show which links will be added where
   - Show total count: "X memories will be updated, Y unchanged"

4. **Ask for approval** before making any changes.

5. **Execute changes**: Apply updates one at a time using `memory_update`. For each change:
   - Update the memory
   - If the change affects cross-references (title rename, ID change from merge, deletion), update all memories that link to it

6. **Handle merges** (when the instruction is to combine notes):
   - Draft merged content — deduplicate, organize by topic, preserve all unique details
   - Create the merged memory with `memory_create`
   - Update all backlinks in other memories to point to the new ID
   - Remove the original source memories with `memory_remove`
   - Remove `mor:` links between source memories (they'd be self-references)

7. **Handle cross-reference additions**:
   - Read all target memories
   - Identify genuine connections (shared concepts, imports, explicit references)
   - Add `[Title](mor:<id>)` links in content preambles or inline where natural
   - For file/snippet notes (content is a code block), add links as a preamble paragraph before the code

8. **Report results**: Summarize what was changed.

## Cross-reference rules

- Content links: `[Title](mor:shortid)` — proper markdown links only
- Use 8-char short IDs in links
- When renaming a memory, no link updates needed (links use IDs, not titles)
- When merging, replace all `mor:<old-id>` with `mor:<new-id>` in linking memories
- When deleting, warn about orphaned backlinks
- Run `mor links --broken` after to verify no dangling references

## Important

- Always show the plan and get approval before making changes
- Preserve all content — consolidation means organizing, not summarizing
- Be conservative with cross-references — only link when there's a genuine, specific connection, not just shared tags
- Short ID prefixes (8+ hex chars) work for all `mor` commands and links
