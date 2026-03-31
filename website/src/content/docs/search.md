---
title: Search
description: How mor finds your memories
---

mor offers three ways to search, each suited to different needs.

## Full-text search (`find`)

Uses SQLite FTS5 with the `porter unicode61` tokenizer.

```sh
mor find "retry http"
```

- **Stemming** — "running" matches "run", "runs", "running"
- **OR-ranked** — multi-word queries match any term, ranked by how many match
- **Unicode-aware** — dots, hyphens, and other punctuation are token separators
- **Scores** — results are ranked 0.0 to 1.0, best match first. Results below threshold are filtered out (default 0.3, configurable via `-s` or `threshold` in config)
- **Access boost** — frequently accessed memories get a small ranking boost (max ~5%), helping surface practical information over time

When [embeddings](/docs/embeddings/) are configured, `find` merges FTS and vector results using [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) — no manual weight tuning needed.

## Grep (`grep`)

Searches by substring or regex.

```sh
mor grep "Retry-After" -i
mor grep -E "async\s+function" -i
```

- **Exact match** — no stemming or tokenization (default)
- **Regex** — with `-E` flag, uses JavaScript regular expressions
- **Case-insensitive** — with `-i` flag
- **Searches title and content** — finds strings anywhere in the memory

Use `grep` for code identifiers, URLs, special characters, patterns, or anything FTS might tokenize away.

## Query resolution (`cat`, `edit`, `rm`, etc.)

Commands that take a `<query>` argument resolve it in order:

1. **Full UUID** — exact match
2. **UUID prefix** — 4+ character prefix, must be unique
3. **Filename** — matches the `.md` filename in the memory folder
4. **FTS search** — falls back to full-text search, returns the top hit

```sh
mor cat 405614a7           # UUID prefix
mor cat retryWithBackoff    # filename match
mor cat "retry backoff"     # FTS search
```

## Filtering

All search commands support filters that narrow results by metadata:

```sh
mor find "http" --tag "rxjs"       # only rxjs-tagged memories
mor grep "TODO" --type snippet     # only snippets
mor ls --ext .fs                   # only F# files
mor ls --repo "github.com/org/*"   # only from specific repos
```

Filters use glob patterns — `*` matches anything, `?` matches one character.
