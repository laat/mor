# mor

A user-controlled memory bank for AI assistants. Stores knowledge as human-readable markdown files with YAML frontmatter, indexed by SQLite for fast full-text and semantic search.

Works as a **CLI tool**, an **MCP server** (for Claude Code / Claude Desktop), and an **HTTP server** for accessing memories across machines on a Tailscale network.

## Install

```sh
npm install -g mor
```

Requires Node.js 20+.

## Quick start

```sh
# Add a memory
echo "Always use snake_case in Python" | mor add --title "Python naming"

# Add from a file
mor add notes.md --title "Meeting notes" --tags "meeting,project-x"

# Search
mor find "python naming"

# Read
mor cat "python naming"

# Edit in $EDITOR
mor edit "python naming"

# List all
mor list

# Remove
mor rm "python naming"
```

## CLI commands

| Command | Description |
|---------|-------------|
| `find <query>` | Search memories (supports `-l, --limit`) |
| `add [file]` | Add memory from file or stdin (`-t, --title`, `--tags`, `--type`) |
| `rm <query>` | Remove a memory |
| `cat <query>` | Print memory content |
| `cp <query> <dest>` | Copy memory to a file |
| `edit <query>` | Open in `$EDITOR` |
| `list` | List all memories |
| `reindex` | Rebuild search index |
| `import <dir>` | Import markdown files from a directory |
| `mcp` | Start MCP server over stdio |
| `serve` | Start HTTP server (`-p, --port`, `-H, --host`, `--token`) |

Queries accept a UUID, UUID prefix (4+ chars), filename, or search text.

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

Exposes tools: `memory_search`, `memory_read`, `memory_add`, `memory_update`, `memory_remove`, `memory_list`.

## Remote access (Tailscale / HTTP)

Run a central memory server on one machine and access it from any other.

**Server machine** — start the HTTP server:

```sh
mor serve --port 7677
```

Or configure in `~/.config/mor/config.json`:

```json
{
  "serve": { "port": 7677, "host": "0.0.0.0", "token": "optional-secret" }
}
```

**Client machine** — point CLI and MCP at the server:

```json
{
  "server": { "url": "http://mybox.tail1234.ts.net:7677", "token": "optional-secret" }
}
```

All CLI commands and MCP tools transparently work over HTTP when `server` is configured. The `reindex` and `import` commands are local-only.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/memories` | List all memories |
| GET | `/memories/search?q=...&limit=N` | Search |
| GET | `/memories/:query` | Read by UUID, prefix, filename, or search |
| POST | `/memories` | Create `{title, content, tags?, type?}` |
| PUT | `/memories/:query` | Update `{title?, content?, tags?, type?}` |
| DELETE | `/memories/:query` | Remove |

Optional bearer token auth via `Authorization: Bearer <token>` header.

## Embeddings (optional)

Enable semantic search by configuring an embedding provider in `~/.config/mor/config.json`:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "baseUrl": "https://api.openai.com/v1",
    "dimensions": 1536
  }
}
```

Supports `openai` (or any compatible API) and `ollama`. Set `OPENAI_API_KEY` for OpenAI. After configuring, run `mor reindex`.

## Storage

Memories live as `.md` files in `~/.config/mor/memories/` with a SQLite index at `~/.config/mor/index.db`. Override the base directory with `MOR_HOME`.

```
~/.config/mor/
  config.json
  index.db
  memories/
    python-naming-a1b2.md
    meeting-notes-c3d4.md
```

Each file has YAML frontmatter (id, title, tags, type, created, updated) and markdown content. Files are git-friendly and human-editable.

## Development

```sh
npm install
npm run build    # compile TypeScript
npm test         # run tests
npm run dev -- find "query"  # run without building
```

## License

MIT
