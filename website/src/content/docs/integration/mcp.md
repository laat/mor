---
title: MCP Server
description: Use mor as an MCP server for AI assistants
---

The MCP server exposes your memory store to AI assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

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

| Tool | Description |
|------|-------------|
| `memory_search` | Full-text search. Returns top result with full content, summaries for rest. |
| `memory_grep` | Literal substring search. For exact strings and code identifiers. |
| `memory_read` | Read a specific memory by UUID, prefix, filename, or search. |
| `memory_add` | Create a new memory. |
| `memory_update` | Update a memory. Returns a diff of changes. |
| `memory_remove` | Delete a memory. |
| `memory_list` | List all memories with descriptions. |

### Filtering

`memory_search`, `memory_grep`, and `memory_list` accept optional filter parameters:

- `tag` — glob pattern matched against tags (e.g. `"rxjs*"`)
- `type` — memory type filter (e.g. `"file"`, `"snippet"`)

## Making Claude use mor first

Claude Code has its own built-in memory system. To make it check mor first, add this to `~/.claude/CLAUDE.md`:

```markdown
## Memory

When the user asks to recall, find, check, or reuse something they
previously saved or remembered — use the `mor` MCP server tools
(`memory_search`, `memory_read`, `memory_list`). This is the user's
primary memory store containing code snippets, files, and reference
notes. Always check mor before saying something wasn't found.
```

## Token efficiency

`memory_search` is designed to minimize token usage:

- The **top result** includes full content — no extra round trip for the best match
- **Other results** show title, tags, description, and score — enough to decide whether to `memory_read`
- **Scores** help the AI decide if the top result is confident or if it should refine the query

## Remote MCP

For accessing mor from claude.ai or other remote MCP clients, see [HTTP Server](/integration/http/) with the `--mcp` flag.
