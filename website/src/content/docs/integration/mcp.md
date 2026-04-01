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

| Tool            | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `memory_search` | Full-text search. Returns top result with full content, summaries for rest.   |
| `memory_grep`   | Substring or regex search. For exact strings, code identifiers, and patterns. |
| `memory_read`   | Read full content of a memory by ID.                                          |
| `memory_create` | Create a new memory with title, content, optional tags and type.              |
| `memory_update` | Update a memory by ID. Returns a diff of changes.                             |
| `memory_remove` | Delete a memory by ID.                                                        |
| `memory_list`   | List all memories with titles, IDs, and tags. Supports pagination.            |

### Filtering

`memory_search`, `memory_grep`, and `memory_list` accept optional parameters:

- `tag` — glob pattern matched against tags (e.g. `"rxjs*"`)
- `type` — memory type filter (e.g. `"file"`, `"snippet"`)
- `limit` — max results (default 20 for search/grep, 100 for list)
- `offset` — skip first N results for pagination

`memory_grep` also accepts:

- `regex` — treat pattern as a JavaScript regular expression
- `ignore_case` — case-insensitive matching

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

## Memberberry hook

You can auto-surface relevant memories on each Claude Code prompt via a `UserPromptSubmit` hook. Instead of injecting full content, it outputs lightweight hints (title, ID, description) so Claude can decide whether to read more via MCP tools.

Save this as e.g. `~/.claude/hooks/memberberry.sh` and make it executable:

<!-- @include hooks/memberberry.sh -->

Then add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": "~/.claude/hooks/memberberry.sh"
      }
    ]
  }
}
```

- Searches top 3 memories per prompt
- Deduplicates within a session (won't re-surface the same memory)
- Skips short prompts (<10 chars) and slash commands
- Requires `jq` and `mor` on PATH

## Remote MCP

For accessing mor from claude.ai or other remote MCP clients, see [HTTP Server](/integration/http/) with the `--mcp` flag.
