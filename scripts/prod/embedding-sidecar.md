# Embedding sidecar on prod (TEI + Qwen3-Embedding-0.6B)

Doc embeddings (semantic search over notes) come from an open model served
next to the server, instead of the hosted default (`gemini-embedding-001`),
which needs a Gemini key this deployment doesn't have. Without a working
embedding model, the embedding job pauses itself and semantic search stays
off.

- Model: **Qwen/Qwen3-Embedding-0.6B**. It returns 1024-dim vectors, matching
  the `vector(1024)` columns, so no migration is needed. It is multilingual.
- Server: Hugging Face **Text Embeddings Inference**, CPU image (~0.9 GB). It
  serves OpenAI-compatible `/v1/embeddings` and uses ~1.7 GB RAM.
  - Ollama was tried first. Its image is 9.4 GB (it bundles GPU libraries)
    and filled the disk mid-deploy, so don't go back to it on this box.
- Server side: `copilot.embedding.url` / `copilot.embedding.model`
  (`plugins/copilot/config.ts`), read by `OpenAICompatibleEmbeddingClient`
  (`plugins/copilot/embedding/client.ts`).

`compose.yml` and `.env` live only on the box, so this file is the record.
Back up both before editing (`*.bak-<timestamp>`).

## 1. `/opt/notesgraph/compose.yml`

```yaml
  embeddings:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.8
    container_name: notesgraph_embeddings
    command:
      - --model-id=Qwen/Qwen3-Embedding-0.6B
      # Qwen3 takes 32k tokens; note chunks are short, and the default batch
      # budget makes warm-up ask for 16 GB.
      - --auto-truncate
      - --max-batch-tokens=2048
      - --max-client-batch-size=16
    volumes:
      - /opt/notesgraph/data/tei:/data
    expose:
      - '80'
    mem_limit: 2560m
    restart: unless-stopped
```

There is no published port: only the server talks to it, over the compose network.

## 2. `/opt/notesgraph/.env`

```
NOTESGRAPH_EMBEDDING_URL=http://embeddings:80/v1
NOTESGRAPH_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B
```

## 3. Apply

```sh
cd /opt/notesgraph
docker compose -f compose.yml --env-file .env up -d embeddings
docker compose -f compose.yml --env-file .env up -d --force-recreate notesgraph
```

The model downloads into `data/tei` on first start (~1.2 GB). The embedding
job picks the client up at server start (`config.init`), and pending docs
are embedded in the background.

Check: `docker logs notesgraph_server | grep -iE 'embedding'` shows no
"Embedding paused", and the `ai_workspace_embeddings` row count grows.

## Disk

The box has a 58 GB disk. Each deploy builds a new server image and leaves
build cache. If it fills up, Yarn fails with odd errors such as
`onnxruntime-node … couldn't be built`. Check with `df -h /` and free space
with `docker builder prune -f`, which only costs build speed.
