# mor

> [!WARNING]
> This is a personal project. I maintain it for my own use and share it because others might find it useful. Feature PRs are unlikely to be merged — if you have an idea, [start a discussion](https://github.com/laat/mor/discussions) first. Fork freely — it's MIT licensed.

AI-accessible knowledge you actually own. **Plain markdown files on your disk**, searchable by AI via MCP.

Your notes live on your disk as plain markdown with YAML frontmatter — readable without mor, portable to any tool, git-syncable across machines. The MCP server gives AI assistants (Claude Code, Claude Desktop, Cursor, etc.) persistent memory that survives context windows. You also get a CLI and HTTP API.

## Install

```sh
npm install -g mor
```

Requires Node.js 20+.

## Quick start

```sh
# Add notes
echo "Always use snake_case for Python variables" | mor add -t "Python naming"
mor add notes.md -t "Meeting notes" --tags "meeting,project-x"
mor add https://raw.githubusercontent.com/owner/repo/main/config.ts

# Search (FTS5 — tokenized, stemmed)
mor find python naming

# Grep (literal substring or regex)
mor grep snake_case
mor grep -i todo
mor grep -E "async\s+function"
mor grep -w Beer -n -C 2

# Read, edit, copy, remove
mor cat python naming
mor edit python naming
mor cp -o ./out.md python naming
mor rm python naming

# List
mor ls
mor ls -l
```

## Commands

| Command           | Description                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `find <query>`    | Full-text search (`--limit`, `-s` threshold, `--json`)                                                          |
| `grep <pattern>`  | Substring or regex search (`-i`, `-E` regex, `-w` word, `-n` line numbers, `-l` files only, `-A/-B/-C` context) |
| `add [file\|url]` | Add from file, URL, stdin, or `$EDITOR` (`-t` title, `-d` description, `--tags`, `--type`)                      |
| `cat <query>`     | Print content (`--raw` for frontmatter, `--links` for cross-references)                                         |
| `cp <query...>`   | Copy content to file (`-o <dest>`)                                                                              |
| `edit <query>`    | Open in `$EDITOR` (`--raw` to edit frontmatter)                                                                 |
| `update <query>`  | Update metadata or content (`-t` title, `-d` description, `--tags`, `--type`, `--content-from`)                 |
| `rm <query>`      | Remove a note                                                                                                   |
| `links [query]`   | Show cross-references for a note (`--broken` to find dangling links)                                            |
| `ls`              | List all (`--limit`, `-l` long, `--tags`, `--types`)                                                            |
| `sync`            | Pull, commit, and push the notes folder via git                                                                 |
| `reindex`         | Rebuild search index                                                                                            |
| `import <dir>`    | Import `.md` files from a directory                                                                             |
| `mcp`             | Start MCP server (stdio)                                                                                        |
| `serve`           | Start HTTP server (`-p` port, `-H` host, `--token`, `--mcp`)                                                    |
| `login`           | Authenticate with a remote server via OAuth (`-s` server URL)                                                   |

Queries resolve in order: full UUID, UUID prefix (8+ chars), filename, FTS search. Multi-word queries don't need quoting — options go before the query: `mor find --limit 5 python naming`.

`find`, `grep`, and `ls` support shared filters: `--type`, `--tag`, `--repo`, `--ext` (all support glob patterns).

## MCP server

Add to your Claude Code or Claude Desktop config:

```json
{
  "mcpServers": {
    "mor": {
      "command": "mor",
      "args": ["mcp"]
    }
  }
}
```

Tools: `notes_search`, `notes_read`, `notes_create`, `notes_update`, `notes_remove`, `notes_list`, `notes_grep`.

To make sure Claude Code checks mor first when you ask it to recall something, add this to `~/.claude/CLAUDE.md`:

```markdown
## Notes

When the user asks to recall, find, check, or reuse something they previously saved
or remembered — use the `mor` MCP server tools (`notes_search`, `notes_read`,
`notes_list`). This is the user's primary note store containing code snippets,
files, and reference notes. Always check mor before saying something wasn't found.
```

## Remote access

Run the server on one machine, access from anywhere:

```sh
# Server
mor serve --port 7677 --token mypassphrase --mcp
```

### MCP clients (Claude Code, Claude Desktop, etc.)

Point your MCP client at the server URL — no secret in the config:

```json
{
  "mcpServers": {
    "mor": {
      "type": "url",
      "url": "http://mybox.tail1234.ts.net:7677/mcp"
    }
  }
}
```

The client discovers auth via `WWW-Authenticate` → OAuth metadata → browser passphrase flow, all automatic.

### CLI client

```sh
# OAuth login — saves server URL to config and credentials to credentials.json
mor login -s http://mybox.tail1234.ts.net:7677

# All commands now proxy to the remote server
mor find "python naming"
```

Or configure a direct token instead:

```jsonc
// ~/.config/mor/config.json
{
  "server": {
    "url": "http://mybox.tail1234.ts.net:7677",
    "token": "mypassphrase",
  },
}
```

OAuth tokens auto-refresh on expiry.

### Authentication

When `--token` is set, all routes require auth. Two methods work everywhere:

- **Bearer token**: `Authorization: Bearer <passphrase>` or `?token=<passphrase>`
- **OAuth access token**: obtained via the OAuth flow (`mor login` or MCP client auto-discovery)

Unauthenticated requests get a `401` with a `WWW-Authenticate` header pointing to the OAuth discovery endpoint.

### HTTP API

| Method   | Path                                                      | Description                                                          |
| -------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/health`                                                 | Health check                                                         |
| `GET`    | `/notes?limit=N&offset=N`                                 | List all                                                             |
| `GET`    | `/notes/search?q=...&limit=N&offset=N`                    | FTS search                                                           |
| `GET`    | `/notes/grep?q=...&limit=N&offset=N&ignoreCase=1&regex=1` | Substring or regex search                                            |
| `GET`    | `/notes/:query`                                           | Read one                                                             |
| `GET`    | `/notes/:query/links`                                     | Get forward and backlinks                                            |
| `POST`   | `/notes`                                                  | Create (`{title, content, description?, tags?, type?, repository?}`) |
| `PUT`    | `/notes/:query`                                           | Update (`{title?, description?, content?, tags?, type?}`)            |
| `DELETE` | `/notes/:query`                                           | Remove                                                               |
| `POST`   | `/mcp`                                                    | MCP protocol (streamable HTTP)                                       |

## Embeddings

Optionally augment FTS search with vector similarity. Configure in `~/.config/mor/config.json`:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Providers: `openai` (or compatible API via `baseUrl`), `azure-openai`, `ollama`. Run `mor reindex` after configuring.

Azure OpenAI uses `AZURE_OPENAI_API_KEY` (or `apiKey` in config) and requires a `deployment` name (defaults to model name).

## Storage

Notes are markdown files with YAML frontmatter, stored in `~/.config/mor/notes/` with a SQLite index at `~/.config/mor/index.db`. Override with `MOR_HOME`.

```
~/.config/mor/
  config.json
  credentials.json   # OAuth tokens (created by `mor login`)
  index.db           # search index
  oauth.db           # OAuth clients and tokens (server-side)
  notes/
    python-naming-a1b2.md
    meeting-notes-c3d4.md
```

Files are human-readable and git-friendly. Use `mor sync` to pull, commit, and push if the notes folder is a git repo. Enable `autosync` to sync automatically after every add, update, or remove:

```json
{
  "autosync": true
}
```

## License

MIT
