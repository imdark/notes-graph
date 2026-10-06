import { createHash } from 'node:crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';

import { Config } from '../../../base';
import { CopilotFailedToGenerateEmbedding } from '../../../base/error/errors.gen';
import {
  ChunkSimilarity,
  Embedding,
  EMBEDDING_DIMENSIONS,
} from '../../../models';
import { type CopilotRerankRequest } from '../providers/types';
import { CapabilityRuntime } from '../runtime/capability-runtime';
import { TaskPolicy } from '../runtime/task-policy';
import {
  type EmbeddingCallOptionsInput,
  EmbeddingClient,
  normalizeEmbeddingCallOptions,
  type ReRankResult,
} from './types';

class ProductionEmbeddingClient extends EmbeddingClient {
  private readonly logger = new Logger(ProductionEmbeddingClient.name);

  constructor(
    private readonly taskPolicy: TaskPolicy,
    private readonly runtime: CapabilityRuntime
  ) {
    super();
  }

  override async configured(): Promise<boolean> {
    const result = await this.runtime.embeddingConfigured(
      this.taskPolicy.resolveEmbeddingModelId()
    );
    if (!result) {
      this.logger.warn(
        'Copilot embedding client is not configured properly, please check your configuration.'
      );
    }
    return result;
  }

  async getEmbeddings(
    input: string[],
    options?: EmbeddingCallOptionsInput
  ): Promise<Embedding[]> {
    const normalizedOptions = normalizeEmbeddingCallOptions(options);
    const modelId = this.taskPolicy.resolveEmbeddingModelId();
    const embeddings = await this.runtime.embed(modelId, input, {
      dimensions: EMBEDDING_DIMENSIONS,
      signal: normalizedOptions.signal,
      user: normalizedOptions.userId,
      workspace: normalizedOptions.workspaceId,
      byokLeaseId: normalizedOptions.byokLeaseId,
      featureKind: normalizedOptions.featureKind ?? 'embedding',
    });
    if (embeddings.length !== input.length) {
      throw new CopilotFailedToGenerateEmbedding({
        provider: modelId,
        message: `Expected ${input.length} embeddings, got ${embeddings.length}`,
      });
    }

    return Array.from(embeddings.entries()).map(([index, embedding]) => ({
      index,
      embedding,
      content: input[index],
    }));
  }

  private getTargetId<T extends ChunkSimilarity>(embedding: T) {
    return 'docId' in embedding && typeof embedding.docId === 'string'
      ? embedding.docId
      : 'fileId' in embedding && typeof embedding.fileId === 'string'
        ? embedding.fileId
        : '';
  }

  private async getEmbeddingRelevance<
    Chunk extends ChunkSimilarity = ChunkSimilarity,
  >(
    query: string,
    embeddings: Chunk[],
    options?: EmbeddingCallOptionsInput
  ): Promise<ReRankResult> {
    const normalizedOptions = normalizeEmbeddingCallOptions(options);
    if (!embeddings.length) return [];

    const rerankRequest: CopilotRerankRequest = {
      query,
      candidates: embeddings.map((embedding, index) => ({
        id: String(index),
        text: embedding.content,
      })),
    };

    const ranks = await this.runtime.rerank(
      this.taskPolicy.resolveRerankModelId(),
      rerankRequest,
      {
        signal: normalizedOptions.signal,
        user: normalizedOptions.userId,
        workspace: normalizedOptions.workspaceId,
        byokLeaseId: normalizedOptions.byokLeaseId,
        featureKind: 'rerank',
      }
    );

    try {
      return ranks.map((score, i) => {
        const chunk = embeddings[i];
        return {
          chunk: chunk.chunk,
          targetId: this.getTargetId(chunk),
          score: Math.max(score, 1 - (chunk.distance || -Infinity)),
        };
      });
    } catch (error) {
      this.logger.error('Failed to parse rerank results', error);
      // silent error, will fallback to default sorting in parent method
      return [];
    }
  }

  override async reRank<Chunk extends ChunkSimilarity = ChunkSimilarity>(
    query: string,
    embeddings: Chunk[],
    topK: number,
    options?: EmbeddingCallOptionsInput
  ): Promise<Chunk[]> {
    const normalizedOptions = normalizeEmbeddingCallOptions(options);
    // search in context and workspace may find same chunks, de-duplicate them
    const { deduped: dedupedEmbeddings } = embeddings.reduce(
      (acc, e) => {
        const key = `${this.getTargetId(e)}:${e.chunk}`;
        if (!acc.seen.has(key)) {
          acc.seen.add(key);
          acc.deduped.push(e);
        }
        return acc;
      },
      { deduped: [] as Chunk[], seen: new Set<string>() }
    );
    const sortedEmbeddings = dedupedEmbeddings.toSorted(
      (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)
    );

    const chunks = sortedEmbeddings.reduce(
      (acc, e) => {
        const targetId = this.getTargetId(e);
        const key = `${targetId}:${e.chunk}`;
        acc[key] = e;
        return acc;
      },
      {} as Record<string, Chunk>
    );

    try {
      // The rerank prompt is expected to handle the full deduped candidate list.
      const ranks = await this.getEmbeddingRelevance(
        query,
        sortedEmbeddings,
        normalizedOptions
      );
      if (sortedEmbeddings.length !== ranks.length) {
        // llm return wrong result, fallback to default sorting
        this.logger.warn(
          `Batch size mismatch: expected ${sortedEmbeddings.length}, got ${ranks.length}`
        );
        return await super.reRank(
          query,
          dedupedEmbeddings,
          topK,
          normalizedOptions
        );
      }

      const highConfidenceChunks = ranks
        .flat()
        .toSorted((a, b) => b.score - a.score)
        .filter(r => r.score > 0.5)
        .map(r => chunks[`${r.targetId}:${r.chunk}`])
        .filter(Boolean);

      this.logger.verbose(
        `ReRank completed: ${highConfidenceChunks.length} high-confidence results found, total ${sortedEmbeddings.length} embeddings`,
        highConfidenceChunks.length !== sortedEmbeddings.length
          ? JSON.stringify(ranks)
          : undefined
      );
      return highConfidenceChunks.slice(0, topK);
    } catch (error) {
      this.logger.warn('ReRank failed, falling back to default sorting', error);
      return await super.reRank(
        query,
        dedupedEmbeddings,
        topK,
        normalizedOptions
      );
    }
  }
}

/** Inputs per request; keeps one request small for a CPU-served model. */
const OPENAI_COMPATIBLE_BATCH = 4;
/**
 * Requests in flight at once. A CPU-served model works through one request
 * at a time; a second only waits inside it, where it can outlast the client
 * timeout and have its finished work thrown away. The rest wait here.
 */
const OPENAI_COMPATIBLE_MAX_IN_FLIGHT = 1;
/** Per request, counted from when it is sent, not while it waits its turn. */
const OPENAI_COMPATIBLE_TIMEOUT_MS = 5 * 60_000;

/**
 * What some models expect before a search query (not before the passages
 * being searched), matched by model name.
 */
const QUERY_PREFIXES: [RegExp, string][] = [
  [
    /mxbai-embed/i,
    'Represent this sentence for searching relevant passages: ',
  ],
];

/**
 * Embeddings from an OpenAI-compatible endpoint (`POST {url}/embeddings`),
 * e.g. an open model served by Ollama next to the server. Reranking falls
 * back to vector distance (the base class), which needs no model at all.
 */
export class OpenAICompatibleEmbeddingClient extends EmbeddingClient {
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  /** Run `send` when one of the in-flight slots is free. */
  private async throttled<T>(send: () => Promise<T>): Promise<T> {
    if (this.inFlight >= OPENAI_COMPATIBLE_MAX_IN_FLIGHT) {
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.inFlight += 1;
    try {
      return await send();
    } finally {
      this.inFlight -= 1;
      this.waiting.shift()?.();
    }
  }

  constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    super();
  }

  private fail(message: string): never {
    throw new CopilotFailedToGenerateEmbedding({
      provider: `${this.model} at ${this.url}`,
      message,
    });
  }

  private async embedBatch(input: string[], signal?: AbortSignal) {
    return await this.throttled(() => this.sendBatch(input, signal));
  }

  private async sendBatch(input: string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const response = await this.fetchImpl(
      `${this.url.replace(/\/$/, '')}/embeddings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(OPENAI_COMPATIBLE_TIMEOUT_MS)])
          : AbortSignal.timeout(OPENAI_COMPATIBLE_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      this.fail(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      data?: { index: number; embedding: number[] }[];
    };
    const data = (body.data ?? []).toSorted((a, b) => a.index - b.index);
    if (data.length !== input.length) {
      this.fail(`Expected ${input.length} embeddings, got ${data.length}`);
    }
    for (const item of data) {
      if (item.embedding?.length !== EMBEDDING_DIMENSIONS) {
        this.fail(
          `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${item.embedding?.length}; pick a model that outputs ${EMBEDDING_DIMENSIONS}`
        );
      }
    }
    return data.map(item => item.embedding);
  }

  override async configured(): Promise<boolean> {
    return !!this.url && !!this.model;
  }

  override async getEmbedding(
    query: string,
    options?: EmbeddingCallOptionsInput
  ) {
    const prefix =
      QUERY_PREFIXES.find(([model]) => model.test(this.model))?.[1] ?? '';
    return await super.getEmbedding(prefix + query, options);
  }

  async getEmbeddings(
    input: string[],
    options?: EmbeddingCallOptionsInput
  ): Promise<Embedding[]> {
    const { signal } = normalizeEmbeddingCallOptions(options);
    const vectors: number[][] = [];
    for (let i = 0; i < input.length; i += OPENAI_COMPATIBLE_BATCH) {
      vectors.push(
        ...(await this.embedBatch(input.slice(i, i + OPENAI_COMPATIBLE_BATCH), signal))
      );
    }
    return vectors.map((embedding, index) => ({
      index,
      embedding,
      content: input[index],
    }));
  }
}

@Injectable()
export class CopilotEmbeddingClientService {
  private client: EmbeddingClient | undefined;

  constructor(
    private readonly taskPolicy: TaskPolicy,
    private readonly runtime: CapabilityRuntime,
    @Optional() private readonly config?: Config
  ) {}

  async refresh() {
    // An open model configured to serve embeddings wins over the hosted
    // default, which needs a provider key this deployment may not have.
    const { url = '', model = '' } = this.config?.copilot.embedding ?? {};
    const client: EmbeddingClient = url
      ? new OpenAICompatibleEmbeddingClient(url, model)
      : new ProductionEmbeddingClient(this.taskPolicy, this.runtime);
    await client.configured();
    this.client = client;
    return this.client;
  }

  getClient() {
    return this.client;
  }
}

export class MockEmbeddingClient extends EmbeddingClient {
  private embed(content: string) {
    const seed = createHash('sha256').update(content).digest();
    return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => {
      const byte = seed[index % seed.length];
      return byte / 255;
    });
  }

  async getEmbeddings(input: string[]): Promise<Embedding[]> {
    return input.map((content, i) => ({
      index: i,
      content,
      embedding: this.embed(content),
    }));
  }
}
