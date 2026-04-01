---
title: Getting Started
description: Install mor and start remembering things
---

## Install

```sh
npm install -g mor
```

Requires Node.js 20+.

## Quick start

```sh
# Add a memory from a file
mor add retryWithBackoff.ts -d "RxJS retry with exponential backoff"

# Add from stdin
echo "Always use snake_case in Python" | mor add -t "Python naming"

# Add from a URL
mor add https://raw.githubusercontent.com/owner/repo/main/config.ts

# Search (full-text, OR-ranked)
mor find "retry http"

# Grep (substring or regex, with context)
mor grep "snake_case"
mor grep -E "async\s+function" -i
mor grep -w "TODO" -n -C 2

# List all
mor ls

# Read
mor cat "retry"

# Edit in $EDITOR
mor edit "retry"
```

## Set up MCP for your AI

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

To make Claude Code check mor first when you ask it to recall something, add this to `~/.claude/CLAUDE.md`:

```markdown
## Memory

When the user asks to recall, find, check, or reuse something they
previously saved or remembered — use the `mor` MCP server tools
(`memory_search`, `memory_read`, `memory_list`). This is the user's
primary memory store containing code snippets, files, and reference
notes. Always check mor before saying something wasn't found.
```
