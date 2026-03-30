---
title: Remote Access
description: Access your memories from any machine
---

Run a central memory server on one machine and access it from any other — across your Tailscale network, VPN, or local network.

## Server setup

On the machine that stores your memories:

```sh
mor serve --port 7677 --host 0.0.0.0 --token your-secret
```

## Client setup

On any other machine, configure `~/.config/mor/config.json`:

```json
{
  "server": {
    "url": "http://mybox.tail1234.ts.net:7677",
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

## Tailscale example

1. Install [Tailscale](https://tailscale.com/) on both machines
2. On the server: `mor serve --port 7677 --host 0.0.0.0 --token secret`
3. Find your Tailscale hostname: `tailscale status`
4. On the client, set `server.url` to `http://your-hostname:7677`

## Remote MCP for claude.ai

Enable the MCP HTTP transport on the server:

```sh
mor serve --port 7677 --host 0.0.0.0 --token secret --mcp
```

Then connect claude.ai (or any remote MCP client) to `http://your-hostname:7677/mcp` with bearer token auth.
