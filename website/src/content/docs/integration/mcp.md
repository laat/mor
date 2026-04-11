---
title: MCP Server
description: Use mor as an MCP server for AI assistants
---

The MCP server exposes your notes store to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Setup

Add to your Claude Code or Claude Desktop MCP config:

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

## Tools

| Tool            | Description                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| `memory_search` | Full-text search. Returns top result with full content, summaries for rest.     |
| `memory_grep`   | Substring or regex search. For exact strings, code identifiers, and patterns.   |
| `memory_read`   | Read memory by ID. Returns separate blocks: metadata, content, links.           |
| `memory_create` | Create a new memory with title, content, optional tags and type.                |
| `memory_update` | Update a memory by ID. Returns a diff of changes, or "no changes" if identical. |
| `memory_remove` | Delete a memory by ID.                                                          |
| `memory_list`   | List all memories with titles, IDs, and tags. Supports pagination.              |

### Filtering

`memory_search`, `memory_grep`, and `memory_list` accept optional parameters:

- `tag` — array of glob patterns matched against tags with AND logic (e.g. `["rxjs", "typescript"]`)
- `type` — memory type filter (e.g. `"file"`, `"snippet"`)
- `limit` — max results (default 20 for search/grep, 100 for list)
- `offset` — skip first N results for pagination

`memory_grep` also accepts:

- `regex` — treat pattern as a JavaScript regular expression
- `ignore_case` — case-insensitive matching

## Cross-references

`memory_read` automatically includes cross-references as a separate content block:

- **Forward links** (`→`) — this memory references another
- **Backlinks** (`←`) — another memory references this one
- Links are omitted if the memory has no connections

Links are derived from `[text](mor:<id>)` markdown links in content and `links` arrays in frontmatter. They use 8-char short IDs consistent with list/search output.

## Token efficiency

The MCP tools are designed to minimize token usage:

- **8-char short IDs** in all output — full UUIDs are never shown
- `memory_search` **top result** includes full content — no extra round trip for the best match
- **Other results** show title, tags, description, and score — enough to decide whether to `memory_read`
- `memory_read` returns **separate content blocks** (metadata, content, links) — prevents AI from treating metadata as note content when updating

## Remote MCP

To access mor from claude.ai or other remote MCP clients, start the server with `--mcp` and `--token`:

```sh
mor serve --port 7677 --host 100.64.0.1 --token your-passphrase --mcp
```

Then add just the URL to your MCP client config — no secret needed:

```json
{
  "mcpServers": {
    "memory": {
      "type": "url",
      "url": "http://100.64.0.1:7677/mcp"
    }
  }
}
```

The client authenticates automatically via OAuth (browser passphrase flow). See [Remote Access](/integration/remote/) and [HTTP Server](/integration/http/) for details.
