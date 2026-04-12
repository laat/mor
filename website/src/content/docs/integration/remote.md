---
title: Remote Access
description: Access your notes from any machine
---

Run a central note server on one machine and access it from any other.

## Server setup

On the machine that stores your notes, bind to the network interface you want to expose:

```sh
mor serve --port 7677 --host 100.64.0.1 --token your-passphrase --mcp
```

:::caution
Avoid `--host 0.0.0.0` — this exposes the server on all interfaces. Bind to a specific IP instead, such as your Tailscale/VPN address.
:::

## MCP clients

Point your MCP client at the server URL — no secret needed in the config:

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

The client discovers auth automatically via OAuth: `WWW-Authenticate` → metadata → browser passphrase flow. This works with Claude Code, Claude Desktop, claude.ai, and other MCP clients that support OAuth.

## CLI client

The recommended way to authenticate the CLI is `mor login`:

```sh
# Authenticates via OAuth, saves server URL and credentials
mor login -s http://100.64.0.1:7677

# All commands now proxy to the remote server
mor find "python naming"
mor ls --tags
```

`mor login` opens a browser where you enter the server passphrase. On success, it saves the OAuth credentials to `~/.local/state/mor/credentials.json` and writes the server URL to `config.json`. Tokens auto-refresh on expiry.

Alternatively, configure a direct token:

```json
{
  "server": {
    "url": "http://100.64.0.1:7677",
    "token": "your-passphrase"
  }
}
```

All CLI commands and MCP tools transparently proxy over HTTP when `server` is configured. The `import` command is server-only.

## How it works

The `Operations` interface has two implementations:

- **LocalOperations** — filesystem + SQLite, used when no `server` is configured
- **RemoteOperations** — HTTP client that wraps all operations as API calls

When `server.url` is set in config, the CLI and MCP server automatically use `RemoteOperations`. No code changes needed — everything just works remotely.
