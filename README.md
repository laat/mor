# mor

A shared memory store for humans and AI. Plain markdown files, SQLite full-text search, optional embeddings.

Use it as a **CLI**, an **MCP server** (Claude Code, Claude Desktop, Cursor, etc.), or an **HTTP server** for accessing memories across machines.

## Install

```sh
npm install -g mor
```

Requires Node.js 20+.

## Quick start

```sh
# Add memories
echo "Always use snake_case for Python variables" | mor add -t "Python naming"
mor add notes.md -t "Meeting notes" --tags "meeting,project-x"
mor add https://raw.githubusercontent.com/owner/repo/main/config.ts

# Search (FTS5 — tokenized, stemmed)
mor find "python naming"

# Grep (literal substring — exact matches)
mor grep "snake_case"
mor grep -i "todo"

# Read, edit, copy, remove
mor cat "python naming"
mor edit "python naming"
mor cp "python naming" ./out.md
mor rm "python naming"

# List
mor ls
mor ls -l
```

## Commands

| Command | Description |
|---------|-------------|
| `find <query>` | Full-text search (`-n` limit, `-l` long) |
| `grep <pattern>` | Literal substring search (`-n` limit, `-i` case-insensitive, `-l` long) |
| `add [file\|url]` | Add from file, URL, stdin, or `$EDITOR` (`-t` title, `--tags`, `--type`) |
| `cat <query>` | Print content (`--raw` for frontmatter) |
| `cp <query> <dest>` | Copy content to file |
| `edit <query>` | Open in `$EDITOR` (`--raw` to edit frontmatter) |
| `update <query>` | Update metadata (`-t` title, `--tags`, `--type`) |
| `rm <query>` | Remove a memory |
| `ls` | List all (`-n` limit, `-l` long) |
| `push` | Git commit and push the memory folder |
| `reindex` | Rebuild search index |
| `import <dir>` | Import `.md` files from a directory |
| `mcp` | Start MCP server (stdio) |
| `serve` | Start HTTP server (`-p` port, `-H` host, `--token`) |

Queries resolve in order: full UUID, UUID prefix (4+ chars), filename, FTS search.

## MCP server

Add to your Claude Code or Claude Desktop config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "mor",
      "args": ["mcp"]
    }
  }
}
```

Tools: `memory_search`, `memory_read`, `memory_add`, `memory_update`, `memory_remove`, `memory_list`.

## Remote access

Run the server on one machine, access from anywhere:

```sh
# Server
mor serve --port 7677
```

```jsonc
// Client — ~/.config/mor/config.json
{
  "server": {
    "url": "http://mybox.tail1234.ts.net:7677",
    "token": "optional-secret"
  }
}
```

All CLI commands and MCP tools transparently proxy over HTTP when `server` is configured.

### HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/memories` | List all |
| `GET` | `/memories/search?q=...&limit=N` | FTS search |
| `GET` | `/memories/grep?q=...&limit=N&ignoreCase=1` | Literal substring search |
| `GET` | `/memories/:query` | Read one |
| `POST` | `/memories` | Create (`{title, content, tags?, type?}`) |
| `PUT` | `/memories/:query` | Update (`{title?, content?, tags?, type?}`) |
| `DELETE` | `/memories/:query` | Remove |

Auth: `Authorization: Bearer <token>` header when token is configured.

## Embeddings (optional)

Add semantic search by configuring an embedding provider in `~/.config/mor/config.json`:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Supports `openai` (or any compatible API via `baseUrl`) and `ollama`. Set `OPENAI_API_KEY` for OpenAI. Run `mor reindex` after configuring.

## Storage

Memories are markdown files with YAML frontmatter, stored in `~/.config/mor/memories/` with a SQLite index at `~/.config/mor/index.db`. Override with `MOR_HOME`.

```
~/.config/mor/
  config.json
  index.db
  memories/
    python-naming-a1b2.md
    meeting-notes-c3d4.md
```

Files are human-readable and git-friendly. Use `mor push` to commit and push if the memory folder is a git repo.

## License

MIT
