---
title: Remote Access
description: Access your memories from any machine
---

Run a central memory server on one machine and access it from any other.

## Server setup

On the machine that stores your memories, bind to the network interface you want to expose:

```sh
mor serve --port 7677 --host 100.64.0.1 --token your-secret
```

:::caution
Avoid `--host 0.0.0.0` — this exposes the server on all interfaces. Bind to a specific IP instead, such as your Tailscale/VPN address.
:::

## Client setup

On any other machine, configure `~/.config/mor/config.json`:

```json
{
  "server": {
    "url": "http://100.64.0.1:7677",
    "token": "your-secret"
  }
}
```

All CLI commands and MCP tools transparently proxy over HTTP when `server` is configured. The `import` command is server-only.

## How it works

The `Operations` interface has two implementations:

- **LocalOperations** — filesystem + SQLite, used when no `server` is configured
- **RemoteOperations** — HTTP client that wraps all operations as API calls

When `server.url` is set in config, the CLI and MCP server automatically use `RemoteOperations`. No code changes needed — everything just works remotely.

## Remote MCP for claude.ai

Enable the MCP HTTP transport on the server:

```sh
mor serve --port 7677 --host 100.64.0.1 --token secret --mcp
```

Then connect claude.ai (or any remote MCP client) to `http://100.64.0.1:7677/mcp` with bearer token auth.
