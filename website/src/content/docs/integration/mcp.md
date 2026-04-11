---
title: MCP Server
description: Use mor as an MCP server for AI assistants
---

The MCP server exposes your note store to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Setup

Add to your Claude Code or Claude Desktop MCP config:

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

## Tools

| Tool           | Description                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `notes_search` | Full-text search. Returns top result with full content, summaries for rest.   |
| `notes_grep`   | Substring or regex search. For exact strings, code identifiers, and patterns. |
| `notes_read`   | Read note by ID. Returns separate blocks: metadata, content, links.           |
| `notes_create` | Create a new note with title, content, optional tags and type.                |
| `notes_update` | Update a note by ID. Returns a diff of changes, or "no changes" if identical. |
| `notes_patch`  | Apply a str_replace patch to a note's content.                                |
| `notes_remove` | Delete a note by ID.                                                          |
| `notes_list`   | List all notes with titles, IDs, and tags. Supports pagination.               |

### Filtering

`notes_search`, `notes_grep`, and `notes_list` accept optional parameters:

- `tag` — array of glob patterns matched against tags with AND logic (e.g. `["rxjs", "typescript"]`)
- `type` — note type filter (e.g. `"file"`, `"snippet"`)
- `limit` — max results (default 20 for search/grep, 100 for list)
- `offset` — skip first N results for pagination

`notes_grep` also accepts:

- `regex` — treat pattern as a JavaScript regular expression
- `ignore_case` — case-insensitive matching

## Cross-references

`notes_read` automatically includes cross-references as a separate content block:

- **Forward links** (`→`) — this note references another
- **Backlinks** (`←`) — another note references this one
- Links are omitted if the note has no connections

Links are derived from `[text](mor:<id>)` markdown links in content and `links` arrays in frontmatter. They use 8-char short IDs consistent with list/search output.

## Token efficiency

The MCP tools are designed to minimize token usage:

- **8-char short IDs** in all output — full UUIDs are never shown
- `notes_search` **top result** includes full content — no extra round trip for the best match
- **Other results** show title, tags, description, and score — enough to decide whether to `notes_read`
- `notes_read` returns **separate content blocks** (metadata, content, links) — prevents AI from treating metadata as note content when updating

## Remote MCP

To access mor from claude.ai or other remote MCP clients, start the server with `--mcp` and `--token`:

```sh
mor serve --port 7677 --host 100.64.0.1 --token your-passphrase --mcp
```

Then add just the URL to your MCP client config — no secret needed:

```json
{
  "mcpServers": {
    "mor": {
      "type": "url",
      "url": "http://100.64.0.1:7677/mcp"
    }
  }
}
```

The client authenticates automatically via OAuth (browser passphrase flow). See [Remote Access](/integration/remote/) and [HTTP Server](/integration/http/) for details.
