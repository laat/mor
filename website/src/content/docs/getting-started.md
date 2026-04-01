---
title: Getting Started
description: Install mor and start remembering things
---

:::caution[Personal project]
This is a personal project. I maintain it for my own use and share it because others might find it useful. Feature PRs are unlikely to be merged — if you have an idea, [start a discussion](https://github.com/laat/mor/discussions) first. Fork freely — it's MIT licensed.
:::

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
mor find retry http

# Grep (substring or regex, with context)
mor grep snake_case
mor grep -E "async\s+function" -i
mor grep -w TODO -n -C 2

# List all
mor ls

# Read
mor cat retry

# Edit in $EDITOR
mor edit retry
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

For Claude Code-specific setup (CLAUDE.md instruction, memberberry hook), see [Claude Code integration](/docs/integration/claude-code/).
