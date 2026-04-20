---
name: mor
description: The user's personal note store, accessed via the `mor` CLI. Check here first when the user asks to recall, find, or reuse something they previously saved.
---

The user's personal note store. Contains saved code snippets, files, preferences, and reference notes. Check here first when the user asks to recall, find, or reuse something they previously saved. Only create or modify notes when the user explicitly asks — never use this store for your own internal bookkeeping or memory.

Access via the `mor` CLI. Notes are markdown files with metadata (title, tags, type, description).

## Quick reference

### Search notes

Options must come **before** the query (the query is variadic / multi-word).

```bash
# Semantic / full-text search
mor find auth flow                   # multi-word query, no quoting needed
mor find --limit 5 python naming     # limit results
mor find --json auth flow            # JSON output with full content
mor find --tag "python" auth flow    # filter by tag (glob, AND logic)
mor find --type knowledge auth flow  # filter by type

# Exact substring / regex search
mor grep useState                    # exact substring
mor grep -i createServer             # case-insensitive
mor grep -E "async\s+function"       # treat as regex
mor grep -C 3 useState               # show 3 lines of context
mor grep -l useState                 # show only note titles (no matching lines)
```

### List notes

```bash
mor ls                               # list notes (default limit 100)
mor ls -a --tags                     # list all tags with counts
mor ls -a --types                    # list all types with counts
mor ls -l                            # long format (path, date, type)
mor ls --tag "python,api"            # filter by tags
mor ls --type snippet                # filter by type
```

### Read a note

```bash
mor cat fastify server primer        # print note content (query = ID prefix, title, or search term)
mor cat --links 8da8d8f2             # also show cross-references
mor cat --raw 8da8d8f2               # include YAML frontmatter
```

### Create a note

```bash
# From stdin (--title required)
echo "some content" | mor add -t "My note title"

# With metadata
echo "content" | mor add -t "Title" --tags "tag1,tag2" --type knowledge -d "Short description"

# From a file
mor add path/to/file.py              # title defaults to filename, type defaults to file

# From a URL
mor add https://example.com/file.js
```

Note types: `user`, `feedback`, `project`, `reference`, `knowledge`, `snippet`, `file`

### Update a note

```bash
mor update -t "New title" 8da8d8f2
mor update --tags "go,concurrency" 8da8d8f2
mor update --type snippet 8da8d8f2
mor update -d "New description" 8da8d8f2
mor update --content-from path/to/file.md 8da8d8f2   # replace content from file
echo "new content" | mor update --content-from - 8da8d8f2   # replace content from stdin
```

### Patch a note (str_replace)

```bash
mor patch --old "text to find" --new "replacement text" 8da8d8f2
mor patch --old "text to delete" --new "" 8da8d8f2   # delete text
```

### Remove notes

```bash
mor rm <id>                          # remove by ID or ID prefix (8+ chars)
mor rm <id1> <id2>                   # remove multiple
```

## Query resolution

Anywhere `<query>` appears, mor resolves it in this order:

1. Full UUID
2. UUID prefix (8+ characters)
3. Exact filename match
4. Full-text search (returns best match)

Short ID prefixes like `mor cat a1b2c3d4` and multi-word titles like `mor cat fastify server primer` both work.

## Rules

- Always use `mor find` or `mor grep` before creating a note, to avoid duplicates.
- Use `mor patch` (not `mor update --content-from`) for small, targeted edits.
- Keep notes focused — one topic per note.
- Use tags to organize notes by topic or language.
- Use descriptive titles — they are searchable and used as filenames.
- Prefer `--json` on `mor find` when you need to read content of multiple results at once.
