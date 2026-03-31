---
title: CLI Reference
description: All mor commands and their options
---

## Commands

| Command | Description |
|---------|-------------|
| `find <query>` | Full-text search (`-l` limit) |
| `grep <pattern>` | Substring or regex search (`-n` limit, `-i` case-insensitive, `-E` regex, `-l` long) |
| `add [file\|url]` | Add from file, URL, stdin, or `$EDITOR` (`-t` title, `-d` description, `--tags`, `--type`) |
| `cat <query>` | Print content (`--raw` for frontmatter) |
| `cp <query> <dest>` | Copy content to file |
| `edit <query>` | Open in `$EDITOR` (`--raw` to edit frontmatter) |
| `update <query>` | Update metadata or content (`-t`, `-d`, `--tags`, `--type`, `--content-from`) |
| `rm <query>` | Remove a memory |
| `ls` | List all (`-n` limit, `-l` long, `--tags` for tag counts) |
| `sync` | Pull, commit, and push the memory folder via git |
| `reindex` | Rebuild search index |
| `import <dir>` | Import `.md` files from a directory |
| `mcp` | Start MCP server (stdio) |
| `serve` | Start HTTP server (`-p` port, `-H` host, `--token`, `--mcp`) |

## Query resolution

Queries resolve in order:

1. Full UUID
2. UUID prefix (4+ chars)
3. Filename
4. FTS search

## Filters

`find`, `grep`, and `ls` support shared filter options:

| Option | Description |
|--------|-------------|
| `--type <type>` | Filter by memory type (comma-separated, glob) |
| `--tag <pattern>` | Filter by tag (glob) |
| `--repo <pattern>` | Filter by repository (glob) |
| `--ext <ext>` | Filter by file extension in title |

### Examples

```sh
# List only file-type memories
mor ls --type file

# Find typescript memories about http
mor find "http" --tag "typescript"

# List all rxjs snippets
mor ls --tag "rxjs*"

# Filter by repository
mor ls --repo "github.com/myorg/*"

# Filter by extension
mor ls --ext .ts
```

## Adding memories

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

## Updating memories

```sh
# Update metadata only
mor update "retry" -t "New title" --tags "rxjs,http"

# Update content from file
mor update "retry" --content-from ./updated-retry.ts

# Update content from URL
mor update "retry" --content-from https://raw.githubusercontent.com/.../retry.ts

# Update content from stdin
echo "new content" | mor update "retry" --content-from -
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

If your memory folder is a git repository:

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
