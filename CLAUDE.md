# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build          # Compile TypeScript to dist/
pnpm test           # Run all tests (vitest)
pnpm test -- -t "test name"  # Run a single test by name
pnpm lint           # ESLint
pnpm format         # Prettier --write
pnpm format:check   # Check formatting without writing
pnpm dev            # Run CLI via tsx without building
```

## Architecture

A memory bank for AI assistants. Stores knowledge as markdown files with YAML frontmatter, indexed by SQLite (FTS5 + optional vector embeddings).

### Operations Interface

The central abstraction is `Operations` in `operations.ts` with two implementations:

- **LocalOperations** — filesystem + SQLite, used by CLI in local mode and by the HTTP server
- **RemoteOperations** (`operations-client.ts`) — HTTP client that wraps a remote server

All three access surfaces use this interface:

1. **CLI** (`cli.ts`) — Commander-based, calls `getOps(config)` to get local or remote ops
2. **MCP Server** (`mcp.ts`) — Stdio and HTTP transports, creates its own `LocalOperations`
3. **HTTP Server** (`operations-server.ts`) — Hono-based, creates `LocalOperations`

### Search & Query Resolution

`resolveQuery` in `LocalOperations` resolves a user query by trying in order: full UUID → UUID prefix (8+ chars) → filename → FTS search. `search()` does FTS5 search, optionally merged with vector similarity via Reciprocal Rank Fusion (RRF). Frequently accessed memories get a small ranking boost.

`syncIndex` walks the memory directory and upserts changed files by content hash. `syncIndexIfNeeded` is a debounced wrapper (200ms) used on read paths to avoid redundant scans.

All listing APIs (`search`, `grep`, `list`) return paginated results via `Paginated<T>` with `data`, `total`, `offset`, and `limit` fields. `grep` accepts a `GrepOptions` object with `regex` support (JavaScript RegExp via a cached SQLite UDF).

### Storage Format

Memories are markdown files in `~/.config/mor/memories/` (overridable via `MOR_HOME`). Frontmatter: id (UUID), title, tags, type, repository, created, updated. Filenames are slugified title + 4-char hash suffix.

### Database

`db.ts` manages a SQLite database with four tables: `memories` (content), `memories_fts` (FTS5 content-less), `links` (cross-references, derived index), `embeddings` (vector blobs). FTS updates require explicit delete-then-insert with old values — this is handled in `upsertMemoryChecked` and `deleteMemoryFromDb`, both wrapped in transactions.

### Cross-references

Memories can link to each other via `[text](mor:<id>)` markdown links in content or `links` arrays in frontmatter (`{ id, title }` objects). The `links` table is a derived index — rebuilt from content and frontmatter on every upsert and reindex (like FTS). Short ID prefixes (8+ chars) are resolved to full UUIDs at ingest time. `getForwardLinks` and `getBacklinks` in `db.ts` query the table. `getLinks` on `Operations` returns both directions. Reindex does a second pass to resolve forward references to notes indexed later.

## Code Style

- Prettier: single quotes, trailing commas, 2-space indent
- ESLint: `@typescript-eslint/no-explicit-any` is off; underscore-prefixed args (`_text`) are allowed unused
- ESM throughout (`"type": "module"`, `.js` extensions in imports)

## Testing

Tests use Vitest with temp directories (`MOR_HOME` pointed at `mkdtempSync` dirs). Server tests use `port: 0` for automatic port assignment. Each test gets an isolated config and database.
