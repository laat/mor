---
title: Storage
description: How mor stores memories on disk
---

## File format

Memories are markdown files with YAML frontmatter:

````markdown
---
id: 405614a7-a382-49db-bb37-b3f549bfddd1
title: retryWithBackoff.ts
description: RxJS retry with exponential backoff
tags:
  - rxjs
  - fetch
  - typescript
type: file
repository: github.com/myorg/myapp
created: '2026-03-29T16:00:50.050Z'
updated: '2026-03-29T18:35:24.931Z'
---

```typescript
export const retryWithBackoff = <T>(count: number) => {
  // ...
};
```
````

## Directory structure

```
~/.config/mor/
  config.json          # Configuration
  index.db             # SQLite FTS + embeddings index
  memories/
    retry-with-backoff-4056.md
    python-naming-a1b2.md
    meeting-notes-c3d4.md
```

Override the base directory with the `MOR_HOME` environment variable.

## Frontmatter fields

| Field         | Required | Description                                                                        |
| ------------- | -------- | ---------------------------------------------------------------------------------- |
| `id`          | yes      | UUID, auto-generated                                                               |
| `title`       | yes      | Display name                                                                       |
| `description` | no       | Short one-line summary                                                             |
| `tags`        | yes      | Array of strings (can be empty)                                                    |
| `type`        | yes      | One of: `user`, `feedback`, `project`, `reference`, `knowledge`, `snippet`, `file` |
| `repository`  | no       | Source repository (auto-detected from git)                                         |
| `created`     | yes      | ISO 8601 timestamp                                                                 |
| `updated`     | yes      | ISO 8601 timestamp                                                                 |

## Filenames

Filenames are auto-generated from the title: slugified + 4-char hash suffix. For example, `retryWithBackoff.ts` becomes `retrywithbackoff-ts-4056.md`.

## SQLite index

The index at `index.db` contains:

- **memories** table — metadata + content for fast queries
- **memories_fts** — FTS5 virtual table for full-text search
- **embeddings** — vector blobs for semantic search (optional)

The index auto-syncs from the markdown files. If it gets out of sync, run `mor reindex`.

## Git integration

The memory folder can be a git repository. Use `mor sync` to pull remote changes and push local ones:

```sh
cd ~/.config/mor/memories
git init
git remote add origin git@github.com:you/memories.git

# Then from anywhere:
mor sync
```

`mor sync` runs `git pull --rebase --autostash` then commits and pushes.

Enable `autosync` in config to sync automatically after every add, update, or remove:

```json
{
  "autosync": true
}
```

## Configuration

See [Configuration](/docs/config/) for all `config.json` options.
