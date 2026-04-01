---
title: HTTP Server
description: REST API and remote MCP transport
---

Run a memory server and access it from anywhere.

## Start the server

```sh
mor serve --port 7677
```

Or with authentication and MCP:

```sh
mor serve --port 7677 --token secret --mcp
```

### Options

| Option       | Description                                                    | Default     |
| ------------ | -------------------------------------------------------------- | ----------- |
| `-p, --port` | Port to listen on                                              | `7677`      |
| `-H, --host` | Host to bind to                                                | `127.0.0.1` |
| `--token`    | Bearer token for authentication (also via `MOR_TOKEN` env var) | none        |
| `--mcp`      | Enable MCP protocol endpoint at `/mcp`                         | disabled    |

Token precedence: `--token` flag > `MOR_TOKEN` env var > config file.

Options can also be set in `~/.config/mor/config.json`:

```json
{
  "serve": {
    "port": 7677,
    "host": "127.0.0.1",
    "token": "your-secret-token",
    "mcp": true
  }
}
```

## REST API

| Method   | Path                                                         | Description                                  |
| -------- | ------------------------------------------------------------ | -------------------------------------------- |
| `GET`    | `/health`                                                    | Health check                                 |
| `GET`    | `/memories?limit=N&offset=N`                                 | List all (paginated)                         |
| `GET`    | `/memories/search?q=...&limit=N&offset=N`                    | FTS search                                   |
| `GET`    | `/memories/grep?q=...&limit=N&offset=N&ignoreCase=1&regex=1` | Substring or regex search                    |
| `GET`    | `/memories/:query`                                           | Read one                                     |
| `POST`   | `/memories`                                                  | Create (`{title, content, tags?, type?}`)    |
| `PUT`    | `/memories/:query`                                           | Update (`{title?, content?, tags?, type?}`)  |
| `DELETE` | `/memories/:query`                                           | Remove                                       |
| `POST`   | `/reindex`                                                   | Rebuild search index                         |
| `POST`   | `/sync`                                                      | Git pull + commit + push                     |
| `POST`   | `/hooks/memberberry`                                         | Claude Code hook — surface relevant memories |

List, search, and grep endpoints return paginated responses:

```json
{
  "data": [...],
  "total": 42,
  "offset": 0,
  "limit": 20
}
```

Authentication via `Authorization: Bearer <token>` header when token is configured.

## MCP over HTTP

When `--mcp` is enabled, the server exposes a [streamable HTTP MCP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) at `/mcp`. This allows claude.ai and other remote MCP clients to connect.

The MCP endpoint:

- Uses session-based transport (each client gets a session ID)
- Shares the same bearer token auth as the REST API
- Supports POST (requests), GET (SSE streams), and DELETE (session cleanup)

## Security

- **Bearer token** — timing-safe comparison, required on all endpoints when configured
- **DNS rebinding protection** — when bound to loopback (127.0.0.1/localhost), rejects requests with non-loopback Host headers
- **MCP opt-in** — the `/mcp` endpoint is disabled unless explicitly enabled with `--mcp`
