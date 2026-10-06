# Embedding sidecar on prod (TEI + mxbai-embed-large-v1)

Doc embeddings (semantic search over notes) come from an open model served
next to the server, instead of the hosted default (`gemini-embedding-001`),
which needs a Gemini key this deployment doesn't have. Without a working
embedding model, the embedding job pauses itself and semantic search stays
off.

- Model: **mixedbread-ai/mxbai-embed-large-v1** (335M). It returns 1024-dim
  vectors, matching the `vector(1024)` columns, so no migration is needed.
  Search queries get the prefix the model expects (`QUERY_PREFIXES` in
  `embedding/client.ts`); passages go as they are.
  - Qwen/Qwen3-Embedding-0.6B came first. On this 2-vCPU box it managed about
    one batch every couple of minutes: requests queued inside TEI past the
    5-minute client timeout and their work was thrown away
    (`te_request_failure{err="dropped"}`). mxbai is about twice as fast, and
    caps inputs at 512 tokens.
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
      - --model-id=mixedbread-ai/mxbai-embed-large-v1
      # Chunks over the model's 512 tokens are cut, not refused; a small batch
      # budget keeps warm-up memory down.
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
NOTESGRAPH_EMBEDDING_MODEL=mixedbread-ai/mxbai-embed-large-v1
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

## Changing the model

Vectors from different models can't be compared, so after switching, clear
what the old model wrote and let the job redo it (back the table up first):

```sh
docker exec notesgraph_postgres pg_dump -U notesgraph -d notesgraph \
  -t ai_workspace_embeddings -Fc > ai_workspace_embeddings-<model>.dump
docker exec notesgraph_postgres psql -U notesgraph -d notesgraph \
  -c 'TRUNCATE ai_workspace_embeddings'
```

Then recreate the server. The next time the app connects to a workspace, every
doc without embeddings is queued again (`core/sync/gateway.ts`). A doc is
embedded one chunk at a time and each chunk is saved as it's done, so a doc
cut short resumes where it stopped.

## Disk

The box has a 58 GB disk. Each deploy builds a new server image and leaves
build cache. If it fills up, Yarn fails with odd errors such as
`onnxruntime-node … couldn't be built`. Check with `df -h /` and free space
with `docker builder prune -f`, which only costs build speed.
