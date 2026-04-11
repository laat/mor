---
title: Embeddings
description: Optional vector search for semantic matching
sidebar: {}
---

Optionally augment FTS search with vector similarity. When configured, `mor find` merges FTS and vector results using Reciprocal Rank Fusion (RRF) — combining rankings without manual weight tuning.

## Configuration

Add to `~/.config/mor/config.json`:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Then rebuild the index:

```sh
mor reindex
```

Embeddings are computed automatically on `add` and `update`. Only `reindex` is needed for the initial build or after changing providers.

## Providers

### OpenAI

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Set `OPENAI_API_KEY` in your environment. Default base URL is `https://api.openai.com/v1`.

### Azure OpenAI

```json
{
  "embedding": {
    "provider": "azure-openai",
    "model": "text-embedding-3-small",
    "baseUrl": "https://your-resource.openai.azure.com"
  }
}
```

Set `AZURE_OPENAI_API_KEY` in your environment (falls back to `OPENAI_API_KEY`).

The `deployment` name defaults to the model name. Set `"deployment": "my-deploy"` to override. `apiVersion` defaults to `2024-10-21`.

### Ollama

```json
{
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768
  }
}
```

Default base URL is `http://localhost:11434`. No API key needed.

## How it works

1. On `add`/`update`, the note's title + tags + content are concatenated and sent to the embedding provider
2. The resulting vector is stored in the `embeddings` table and indexed via sqlite-vec for fast KNN search
3. On `find`, the query is embedded and compared against stored vectors using cosine distance
4. FTS and vector rankings are combined using Reciprocal Rank Fusion (RRF)
5. Frequently accessed notes get a small ranking boost (~5% max)

## When to use embeddings

Embeddings help when:

- You search for concepts rather than exact words ("error handling" finds `retryWithBackoff.ts`)
- FTS tokenization misses your query (searching "correct" finds `AwaitTaskCorrect`)

Embeddings may not help when:

- Your note store is small (FTS + grep cover most cases)
- You search for exact strings (use `grep` instead)
- Score distributions are flat (all results score similarly)

For most personal use, FTS + grep is sufficient. Embeddings are worth trying if you have hundreds of notes and find yourself refining searches often.
