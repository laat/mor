---
title: Embeddings
description: Optional vector search for semantic matching
sidebar:
  badge:
    text: Experimental
    variant: caution
---

Optionally augment FTS search with vector similarity. When configured, `mor find` merges FTS results (60% weight) with cosine similarity from embeddings (40% weight).

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

1. On `add`/`update`, the memory's title + tags + content are concatenated and sent to the embedding provider
2. The resulting vector is stored as a Float32Array blob in the `embeddings` table
3. On `find`, the query is embedded and compared against all stored vectors via cosine similarity
4. Results below a 0.15 cosine similarity threshold are discarded
5. FTS and vector scores are merged: `ftsScore * 0.6 + vectorScore * 0.4`

## When to use embeddings

Embeddings help when:
- You search for concepts rather than exact words ("error handling" finds `retryWithBackoff.ts`)
- FTS tokenization misses your query (searching "correct" finds `AwaitTaskCorrect`)

Embeddings may not help when:
- Your memory store is small (FTS + grep cover most cases)
- You search for exact strings (use `grep` instead)
- Score distributions are flat (all results score similarly)

For most personal use, FTS + grep is sufficient. Embeddings are worth trying if you have hundreds of memories and find yourself refining searches often.
