---
title: Search
description: How mor finds your notes
---

mor offers three ways to search, each suited to different needs.

## Full-text search (`find`)

Uses SQLite FTS5 with the `porter unicode61` tokenizer.

```sh
mor find "retry http"
mor find "retry http" --json    # JSON output with content
```

- **Stemming** — "running" matches "run", "runs", "running"
- **OR-ranked** — multi-word queries match any term, ranked by how many match
- **Unicode-aware** — dots, hyphens, and other punctuation are token separators
- **Scores** — results are ranked 0.0 to 1.0, best match first. Results below threshold are filtered out (default 0.3, configurable via `-s` or `threshold` in config)
- **Access boost** — frequently accessed notes get a small ranking boost (max ~5%), helping surface practical information over time
- **JSON output** — `--json` returns an array of `{id, title, description, tags, score, content}` for programmatic use (e.g. hooks, scripts)

When [embeddings](/docs/embeddings/) are configured, `find` merges FTS and vector results using [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) — no manual weight tuning needed.

## Grep (`grep`)

Searches by substring or regex.

```sh
mor grep "Retry-After" -i
mor grep -E "async\s+function" -i
```

- **Exact match** — no stemming or tokenization (default)
- **Regex** — with `-E` flag, uses JavaScript regular expressions
- **Word match** — with `-w` flag, matches whole words only
- **Case-insensitive** — with `-i` flag
- **Line numbers** — with `-n` flag
- **Files only** — with `-l` flag, shows only note titles
- **Context** — `-A <n>` after, `-B <n>` before, `-C <n>` both
- **Searches title and content** — finds strings anywhere in the note

Use `grep` for code identifiers, URLs, special characters, patterns, or anything FTS might tokenize away.

## Query resolution (`cat`, `edit`, `rm`, etc.)

Commands that take a `<query>` argument resolve it in order:

1. **Full UUID** — exact match
2. **UUID prefix** — 8+ character prefix, must be unique
3. **Filename** — matches the `.md` filename in the notes folder
4. **FTS search** — falls back to full-text search, returns the top hit

```sh
mor cat 405614a7           # UUID prefix
mor cat retryWithBackoff    # filename match
mor cat "retry backoff"     # FTS search
```

## Filtering

All search commands support filters that narrow results by metadata:

```sh
mor find "http" --tag "rxjs"       # only rxjs-tagged notes
mor grep "TODO" --type snippet     # only snippets
mor ls --ext .fs                   # only F# files
mor ls --repo "github.com/org/*"   # only from specific repos
```

Filters use glob patterns — `*` matches anything, `?` matches one character.
