---
title: CLI Reference
description: All mor commands and their options
---

## Commands

| Command           | Description                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `find <query>`    | Full-text search (`--limit`, `-s` threshold, `--json`)                                                          |
| `grep <pattern>`  | Substring or regex search (`-i`, `-E` regex, `-w` word, `-n` line numbers, `-l` files only, `-A/-B/-C` context) |
| `add [file\|url]` | Add from file, URL, stdin, or `$EDITOR` (`-t` title, `-d` description, `--tags`, `--type`)                      |
| `cat <query>`     | Print content (`--raw` for frontmatter, `--links` for cross-references)                                         |
| `cp <query...>`   | Copy content to file (`-o <dest>`)                                                                              |
| `edit <query>`    | Open in `$EDITOR` (`--raw` to edit frontmatter)                                                                 |
| `update <query>`  | Update metadata or content (`-t`, `-d`, `--tags`, `--type`, `--content-from`)                                   |
| `patch <query>`   | Apply a `str_replace` patch to a note's content (`--old`, `--new`)                                              |
| `rm <query>`      | Remove a note                                                                                                   |
| `links [query]`   | Show cross-references (`--broken` to find dangling links)                                                       |
| `ls`              | List all (`--limit`, `-l` long, `--tags`, `--types`)                                                            |
| `sync`            | Pull, commit, and push the notes folder via git                                                                 |
| `reindex`         | Rebuild search index                                                                                            |
| `import <dir>`    | Import `.md` files from a directory                                                                             |
| `mcp`             | Start MCP server (stdio)                                                                                        |
| `serve`           | Start HTTP server (`-p` port, `-H` host, `--token`, `--mcp`)                                                    |
| `login`           | Authenticate with a remote server via OAuth (`-s` server URL)                                                   |

## Multi-word queries

All commands accept multi-word queries without quoting. Options must come before the query:

```sh
mor cat python naming
mor find --limit 5 python naming
mor cp -o ./out.md fastify server primer
```

## Query resolution

Queries resolve in order:

1. Full UUID
2. UUID prefix (8+ chars)
3. Filename
4. FTS search

## Filters

`find`, `grep`, and `ls` support shared filter options:

| Option             | Description                                 |
| ------------------ | ------------------------------------------- |
| `--type <type>`    | Filter by note type (comma-separated, glob) |
| `--tag <pattern>`  | Filter by tag (glob)                        |
| `--repo <pattern>` | Filter by repository (glob)                 |
| `--ext <ext>`      | Filter by file extension in title           |

### Examples

```sh
# List only file-type notes
mor ls --type file

# Find typescript notes about http
mor find --tag typescript http

# List all rxjs snippets
mor ls --tag "rxjs*"

# Filter by repository
mor ls --repo "github.com/myorg/*"

# Filter by extension
mor ls --ext .ts
```

## Adding notes

```sh
# From a local file (auto-detects type and language tag)
mor add ./src/utils/retry.ts -d "Retry with backoff"

# From a URL (auto-detects GitHub repo)
mor add https://raw.githubusercontent.com/owner/repo/main/lib.ts

# From stdin
echo "SELECT * FROM users" | mor add -t "user query" --type snippet --tags "sql"

# Interactive (opens $EDITOR)
mor add -t "Meeting notes"

# With all options
mor add file.py -t "Custom title" -d "Description" --tags "python,ml" --type file
```

## Updating notes

```sh
# Update metadata only
mor update -t "New title" --tags "rxjs,http" retry

# Update content from file
mor update --content-from ./updated-retry.ts retry

# Update content from URL
mor update --content-from https://raw.githubusercontent.com/.../retry.ts retry

# Update content from stdin
echo "new content" | mor update --content-from - retry
```

## Tag browsing

```sh
# List all tags with counts
mor ls --tags

# Output:
#   10  fsharp
#    7  typescript
#    5  rxjs
#    3  aspnet
```

## Git sync

If your notes folder is a git repository:

```sh
# Pull remote changes, commit and push local changes
mor sync
```

This runs `git pull --rebase --autostash` first, then commits and pushes any local changes.

### Autosync

Enable automatic syncing after every add, update, or remove in `~/.config/mor/config.json`:

```json
{
  "autosync": true
}
```

Each mutation commits with a descriptive message (e.g. `add: Shopping List`) and pushes immediately.

## Cross-references

Notes can link to each other using markdown links with the `mor:` scheme:

```markdown
See [Fastify Chaos Plugin](mor:22f6b489) for resilience testing.
```

Links are extracted from content automatically — the `links` table is a derived index rebuilt on every upsert and reindex.

### Viewing links

```sh
# Show all links for a note (→ forward, ← backlinks, ↔ bidirectional)
mor links fastify chaos plugin

# Show links inline with content
mor cat --links fastify chaos plugin

# Find all notes with broken references
mor links --broken
```

### Frontmatter links

For file/snippet notes where content is a code block, add links in the frontmatter:

```yaml
links:
  - id: 22f6b489
    title: Fastify Chaos Plugin
  - id: 405614a7
    title: rxjs.http.ts
```

Both content links and frontmatter links are merged into the same derived index.
