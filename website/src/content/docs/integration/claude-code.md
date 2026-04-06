---
title: Claude Code
description: Set up mor as a memory store for Claude Code
---

## Plugin

mor ships as a Claude Code plugin. Installing it gives you the MCP server (memory tools), slash commands (`/mor:remember`, `/mor:memory-consolidate`, `/mor:memory-review`), and skills automatically.

```bash
claude plugin marketplace add laat/mor
claude plugin install mor
```

## MCP server (manual)

If you prefer to configure the MCP server without the plugin, add to your Claude Code MCP config:

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

See [MCP Server](/integration/mcp/) for available tools and filtering options.

## CLAUDE.md instruction

Claude Code has its own built-in memory system. To make it check mor first, add this to `~/.claude/CLAUDE.md`:

```markdown
## Memory

When the user asks to recall, find, check, or reuse something they
previously saved or remembered — use the `mor` MCP server tools
(`memory_search`, `memory_read`, `memory_list`). This is the user's
primary memory store containing code snippets, files, and reference
notes. Always check mor before saying something wasn't found.
```

## Memberberry hook

Auto-surface relevant memories on each prompt via a `UserPromptSubmit` hook. Instead of injecting full content, it outputs lightweight hints (title, ID, description) so Claude can decide whether to read more via MCP tools.

### HTTP hook

Requires `mor serve` running. Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7677/hooks/memberberry"
          }
        ]
      }
    ]
  }
}
```

If you configured `mor serve` with a bearer token, add the `Authorization` header:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7677/hooks/memberberry",
            "headers": {
              "Authorization": "Bearer $MOR_TOKEN"
            },
            "allowedEnvVars": ["MOR_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

### Shell hook

Standalone alternative that doesn't require `mor serve`:

```bash
mkdir -p ~/.claude/hooks && curl -sO --output-dir ~/.claude/hooks https://mor.yapping.no/hooks/memberberry.sh && chmod +x ~/.claude/hooks/memberberry.sh
```

<details>
<summary>Script source</summary>

<!-- @include website/public/hooks/memberberry.sh -->

</details>

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

Requires `jq` and `mor` on PATH.

### Behavior

- Searches top 3 memories per prompt
- Deduplicates within a session (won't re-surface the same memory)
- Skips short prompts (<10 chars) and slash commands
