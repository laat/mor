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

| Method   | Path                                                         | Description                                                          |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `GET`    | `/health`                                                    | Health check                                                         |
| `GET`    | `/memories?limit=N&offset=N`                                 | List all (paginated)                                                 |
| `GET`    | `/memories/search?q=...&limit=N&offset=N`                    | FTS search                                                           |
| `GET`    | `/memories/grep?q=...&limit=N&offset=N&ignoreCase=1&regex=1` | Substring or regex search                                            |
| `GET`    | `/memories/:query`                                           | Read one                                                             |
| `GET`    | `/memories/:query/links`                                     | Get forward and backlinks                                            |
| `POST`   | `/memories`                                                  | Create (`{title, content, description?, tags?, type?, repository?}`) |
| `PUT`    | `/memories/:query`                                           | Update (`{title?, description?, content?, tags?, type?}`)            |
| `DELETE` | `/memories/:query`                                           | Remove                                                               |
| `POST`   | `/reindex`                                                   | Rebuild search index                                                 |
| `POST`   | `/sync`                                                      | Git pull + commit + push                                             |
| `POST`   | `/hooks/memberberry`                                         | Claude Code hook — surface relevant memories                         |

List, search, and grep endpoints return paginated responses:

```json
{
  "data": [...],
  "total": 42,
  "offset": 0,
  "limit": 20
}
```

## Authentication

When `--token` is set, all routes require authentication. Two methods work on every endpoint:

- **Bearer token** — `Authorization: Bearer <passphrase>` or `?token=<passphrase>`
- **OAuth access token** — obtained via the OAuth flow (see below)

Unauthenticated requests receive a `401` with a `WWW-Authenticate` header pointing to the OAuth discovery endpoint.

### OAuth flow

The server implements [MCP-spec OAuth 2.0](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization) so clients can connect with just a URL — no secret in the config. The flow:

1. Client hits a protected endpoint, gets `401` with `WWW-Authenticate`
2. Client discovers OAuth metadata at `/.well-known/oauth-authorization-server`
3. Client registers via dynamic client registration at `/oauth/register`
4. User authorizes in the browser (enters the server passphrase)
5. Client exchanges the auth code for access and refresh tokens

MCP clients (Claude Code, Claude Desktop, claude.ai) handle this automatically. For the CLI, use `mor login`.

OAuth state (clients, tokens, auth codes) is persisted in a separate `oauth.db` SQLite database and survives server restarts.

| Endpoint                                        | Description                            |
| ----------------------------------------------- | -------------------------------------- |
| `GET /.well-known/oauth-authorization-server`   | OAuth AS metadata (RFC 8414)           |
| `GET /.well-known/oauth-protected-resource/mcp` | Protected resource metadata (RFC 9728) |
| `POST /oauth/register`                          | Dynamic client registration            |
| `GET /oauth/authorize`                          | Authorization (serves passphrase form) |
| `POST /oauth/token`                             | Token exchange (auth code + PKCE)      |
| `POST /oauth/revoke`                            | Token revocation                       |

## MCP over HTTP

When `--mcp` is enabled, the server exposes a [streamable HTTP MCP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) at `/mcp`. This allows claude.ai and other remote MCP clients to connect.

The MCP endpoint:

- Uses session-based transport (each client gets a session ID)
- Supports POST (requests), GET (SSE streams), and DELETE (session cleanup)

## Security

- **Bearer token** — timing-safe comparison, required on all endpoints when configured
- **OAuth** — PKCE (S256), atomic token consumption prevents replay, tokens stored in SQLite with TTL-based cleanup
- **DNS rebinding protection** — when bound to loopback (127.0.0.1/localhost), rejects requests with non-loopback Host headers
- **MCP opt-in** — the `/mcp` endpoint is disabled unless explicitly enabled with `--mcp`
