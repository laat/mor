---
title: Configuration
description: All config.json options
---

mor is configured via `~/.config/mor/config.json`, auto-created on first run. Override the config directory with the `MOR_HOME` environment variable.

## Full example

```json
{
  "notesDir": "~/.config/mor/notes",
  "dbPath": "~/.config/mor/index.db",
  "autosync": true,
  "threshold": 0.3,
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-..."
  },
  "server": {
    "url": "https://mor.example.com",
    "token": "your-secret"
  },
  "serve": {
    "port": 7677,
    "host": "127.0.0.1",
    "token": "your-secret",
    "mcp": true
  }
}
```

## Core

| Key         | Type    | Default                  | Description                                                                    |
| ----------- | ------- | ------------------------ | ------------------------------------------------------------------------------ |
| `notesDir`  | string  | `~/.config/mor/notes`    | Directory where note markdown files are stored                                 |
| `dbPath`    | string  | `~/.config/mor/index.db` | Path to the SQLite search index                                                |
| `autosync`  | boolean | `false`                  | Auto git pull/commit/push after every add, update, or remove                   |
| `threshold` | number  | `0.3`                    | Minimum relevance score (0–1) for `find` results. Override per-query with `-s` |

## Embedding

Optional vector embeddings to augment FTS search. See [Embeddings](/docs/embeddings/) for details.

| Key                    | Type   | Required | Description                                      |
| ---------------------- | ------ | -------- | ------------------------------------------------ |
| `embedding.provider`   | string | yes      | `openai`, `azure-openai`, `ollama`, or `none`    |
| `embedding.model`      | string | yes      | Model name (e.g. `text-embedding-3-small`)       |
| `embedding.dimensions` | number | yes      | Vector dimensions (e.g. `1536`)                  |
| `embedding.baseUrl`    | string | no       | Custom API base URL                              |
| `embedding.apiKey`     | string | no       | API key (falls back to `OPENAI_API_KEY` env var) |
| `embedding.deployment` | string | no       | Azure OpenAI deployment name (defaults to model) |
| `embedding.apiVersion` | string | no       | Azure OpenAI API version                         |

## Remote server (client)

Connect the CLI and MCP tools to a remote mor server. When `server` is configured, all operations proxy over HTTP.

| Key            | Type   | Required | Description                                      |
| -------------- | ------ | -------- | ------------------------------------------------ |
| `server.url`   | string | yes      | Server URL (e.g. `https://mor.example.com`)      |
| `server.token` | string | no       | Bearer token (falls back to `MOR_TOKEN` env var) |

## HTTP server

Defaults for `mor serve`. CLI flags override these.

| Key           | Type    | Default     | Description                                      |
| ------------- | ------- | ----------- | ------------------------------------------------ |
| `serve.port`  | number  | `7677`      | Port to listen on                                |
| `serve.host`  | string  | `127.0.0.1` | Host to bind to                                  |
| `serve.token` | string  | —           | Bearer token (falls back to `MOR_TOKEN` env var) |
| `serve.mcp`   | boolean | `false`     | Enable MCP endpoint at `/mcp`                    |

## Environment variables

| Variable               | Description                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `MOR_HOME`             | Override the config directory (default `~/.config/mor`)                                   |
| `MOR_TOKEN`            | Bearer token for server/client auth (overrides config file, overridden by `--token` flag) |
| `OPENAI_API_KEY`       | OpenAI API key (used when `embedding.apiKey` is not set)                                  |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key                                                                      |
| `EDITOR`               | Editor used by `mor add` and `mor edit`                                                   |
