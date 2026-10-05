# Ollama embedding sidecar on prod

Doc embeddings (semantic search over notes) come from an open model served
next to the server, instead of the hosted default (`gemini-embedding-001`),
which needs a Gemini key this deployment doesn't have. Without a working
embedding model, the embedding job pauses itself and semantic search stays
off.

- Model: **qwen3-embedding:0.6b**. It returns 1024-dim vectors, matching the
  `vector(1024)` columns, so no migration is needed. It is multilingual and
  uses about 1.2 GB RAM on CPU.
- Server side: `copilot.embedding.url` / `copilot.embedding.model`
  (`plugins/copilot/config.ts`), read by `OpenAICompatibleEmbeddingClient`
  (`plugins/copilot/embedding/client.ts`).

`compose.yml` and `.env` live only on the box, so this file is the record.
Back up both before editing (`*.bak-<timestamp>`).

## 1. `/opt/notesgraph/compose.yml`

There is no published port. Only the server talks to it, over the default
compose network.

```yaml
  ollama:
    image: ollama/ollama:latest
    container_name: notesgraph_ollama
    environment:
      # One model, kept loaded; embeddings only.
      - OLLAMA_KEEP_ALIVE=-1
      - OLLAMA_NUM_PARALLEL=1
    volumes:
      - /opt/notesgraph/data/ollama:/root/.ollama
    expose:
      - '11434'
    mem_limit: 2g
    restart: unless-stopped
```

## 2. `/opt/notesgraph/.env`

```
NOTESGRAPH_EMBEDDING_URL=http://ollama:11434/v1
NOTESGRAPH_EMBEDDING_MODEL=qwen3-embedding:0.6b
```

## 3. Apply

```sh
cd /opt/notesgraph
docker compose -f compose.yml --env-file .env up -d ollama
docker exec notesgraph_ollama ollama pull qwen3-embedding:0.6b
docker compose -f compose.yml --env-file .env up -d --force-recreate notesgraph
```

The embedding job picks the client up at start (`config.init`), so recreating
the server is enough; the pending docs are then embedded in the background.

Check: `docker logs notesgraph_server | grep -iE 'embedding'` shows no
"Embedding paused", and the `ai_workspace_embeddings` row count grows.
