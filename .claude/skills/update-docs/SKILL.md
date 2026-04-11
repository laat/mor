---
name: update-docs
description: Reconcile docs (README, CLAUDE.md, man page, website) with the current source. Only fixes factual drift — does not rewrite prose.
disable-model-invocation: true
---

Update mor's documentation to match the current source code. Be efficient.

## Steps

1. Run `git log --oneline -10` to see recent changes that might affect docs.
2. Read `src/cli.ts` (commander definitions, roughly lines 60–120) for the canonical list of commands and options.
3. Grep `src/operations-server.ts` for `app.get`/`app.post`/`app.put`/`app.delete`/`app.patch` to get the canonical HTTP endpoint list.
4. For each doc file below, read it and only edit if there's an **actual factual discrepancy** with the source:
   - `README.md` — commands table, HTTP API table, examples
   - `CLAUDE.md` — database tables description, architecture overview
   - `man/mor.1` — commands, options. (Do **not** touch the version or date in the `.TH` header here — that's the release skill's job.)
   - `website/src/content/docs/cli.md` — commands table, examples
   - `website/src/content/docs/getting-started.md` — quick start examples
   - `website/src/content/docs/storage.md` — database tables
   - `website/src/content/docs/integration/mcp.md` — MCP tools table
   - `website/src/content/docs/integration/http.md` — REST API table

## Rules

- Only fix factual inaccuracies (renamed commands, removed options, new endpoints, changed table schemas).
- Do **not** rewrite prose, add sections, or change tone.
- Do **not** edit files under `src/`.
- If a doc file is already correct, make no changes to it.
- If nothing needs changing across the whole sweep, say so and stop — don't manufacture work.

## After editing

Show the user a summary of what changed (file + one-line per fix). Don't commit or push automatically — let the user review and run `/commit` themselves.
