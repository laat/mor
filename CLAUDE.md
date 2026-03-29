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
- **RemoteOperations** (`remote.ts`) — HTTP client that wraps a remote server

All three access surfaces use this interface:

1. **CLI** (`cli.ts`) — Commander-based, calls `getOps(config)` to get local or remote ops
2. **MCP Server** (`mcp.ts`) — Stdio transport, creates its own `LocalOperations`
3. **HTTP Server** (`server.ts`) — Raw `http.createServer` with a custom router, creates `LocalOperations`

### Search & Query Resolution

`query.ts:resolveQuery` resolves a user query by trying in order: full UUID → UUID prefix → filename → FTS search. `index.ts:searchAsync` does FTS5 search, optionally merged with vector cosine similarity (60/40 weighting).

`syncIndex` walks the memory directory and upserts changed files by content hash. `syncIndexIfNeeded` is a debounced wrapper (200ms, per-DB via WeakMap) used on read paths to avoid redundant scans.

### Storage Format

Memories are markdown files in `~/.config/mor/memories/` (overridable via `MOR_HOME`). Frontmatter: id (UUID), title, tags, type, repository, created, updated. Filenames are slugified title + 4-char hash suffix.

### Database

`db.ts` manages a SQLite database with three tables: `memories` (content), `memories_fts` (FTS5 content-less), `embeddings` (vector blobs). FTS updates require explicit delete-then-insert with old values — this is handled in `upsertMemoryChecked` and `deleteMemoryFromDb`, both wrapped in transactions.

## Code Style

- Prettier: single quotes, trailing commas, 2-space indent
- ESLint: `@typescript-eslint/no-explicit-any` is off; underscore-prefixed args (`_text`) are allowed unused
- ESM throughout (`"type": "module"`, `.js` extensions in imports)

## Testing

Tests use Vitest with temp directories (`MOR_HOME` pointed at `mkdtempSync` dirs). Server tests use `port: 0` for automatic port assignment. Each test gets an isolated config and database.
