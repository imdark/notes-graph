import { LiveData, Service } from '@notesgraph/infra';
import { combineLatest, debounceTime, map } from 'rxjs';

import { extractMarkdownFromDoc } from '../../../blocksuite/ai/utils/extract';
import type { DocsService } from '../../doc';
import type { WorkspaceService } from '../../workspace';
import { chunkText } from './chunk';
import type { LocalEmbeddingService } from './local-embedding';
import { type VectorSearchResult, VectorStore } from './vector-store';

export type DocEmbedderStatus =
  | { state: 'idle' }
  | { state: 'indexing'; done: number; total: number }
  | { state: 'ready'; docs: number; chunks: number }
  | { state: 'error'; error: string };

/**
 * Builds + maintains the local vector index over the workspace's docs: pulls
 * each doc's markdown (reusing the AI extractor), chunks it, embeds on-device,
 * and upserts into the {@link VectorStore}. Incremental — skips docs whose
 * version is unchanged. Drives semantic search + chat RAG.
 */
export class DocEmbedder extends Service {
  readonly status$ = new LiveData<DocEmbedderStatus>({ state: 'idle' });
  readonly store: VectorStore;
  private running = false;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly docsService: DocsService,
    private readonly embedding: LocalEmbeddingService
  ) {
    super();
    this.store = new VectorStore(this.workspaceService.workspace.id);
    this.setupAutoIndex();
  }

  /**
   * Keep the vector index fresh automatically instead of relying on the manual
   * "Build index" button. Re-indexes (incrementally — {@link embedDoc} skips
   * unchanged docs) whenever the doc set changes, but ONLY while the embedding
   * model is already loaded. It never calls {@link LocalEmbeddingService.ensureLoaded}
   * itself, so a user who hasn't opted into local AI pays nothing: no model
   * download, no compute. Debounced so a burst of edits triggers one pass.
   */
  private setupAutoIndex(): void {
    const sub = combineLatest([
      this.embedding.status$,
      this.docsService.list.docs$,
    ])
      .pipe(
        map(([status]) => status.state === 'ready'),
        debounceTime(4000)
      )
      .subscribe(modelReady => {
        if (modelReady) {
          this.indexAll().catch(err =>
            console.error('[ai-local] auto-index failed', err)
          );
        }
      });
    this.disposables.push(() => sub.unsubscribe());
  }

  private async docText(docId: string): Promise<string> {
    const collection = this.workspaceService.workspace.docCollection;
    const blockDoc = collection.getDoc(docId);
    if (!blockDoc) return '';
    blockDoc.load();
    const store = blockDoc.getStore({ id: docId });
    try {
      return await extractMarkdownFromDoc(store);
    } catch {
      // empty docs throw (no snapshot) — treat as no content
      return '';
    }
  }

  /** Embed a single doc if its content changed since last time. */
  async embedDoc(docId: string): Promise<void> {
    const meta = this.docsService.list.docsMap$.value.get(docId)?.meta$.value;
    if (!meta || meta.trash) {
      await this.store.removeDoc(docId);
      return;
    }
    const version = meta.updatedDate ?? meta.createDate ?? 0;
    if ((await this.store.getDocVersion(docId)) === version) return;

    const body = await this.docText(docId);
    const full = meta.title ? `# ${meta.title}\n\n${body}` : body;
    const chunks = chunkText(full);
    if (chunks.length === 0) {
      await this.store.removeDoc(docId);
      return;
    }
    const embeddings = await this.embedding.embed(chunks);
    await this.store.upsertDoc(
      docId,
      version,
      chunks.map((text, i) => ({ text, embedding: embeddings[i] }))
    );
  }

  /** Embed every (non-trash) doc; prune docs that no longer exist. */
  async indexAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.embedding.ensureLoaded();
      const ids = this.docsService.list.nonTrashDocsIds$.value;
      const total = ids.length;
      this.status$.next({ state: 'indexing', done: 0, total });
      let done = 0;
      for (const id of ids) {
        try {
          await this.embedDoc(id);
        } catch (err) {
          console.error('[ai-local] failed to embed doc', id, err);
        }
        this.status$.next({ state: 'indexing', done: ++done, total });
      }
      // prune docs that were deleted since the last run
      const live = new Set(ids);
      for (const id of await this.store.embeddedDocIds()) {
        if (!live.has(id)) await this.store.removeDoc(id);
      }
      const stats = await this.store.stats();
      this.status$.next({
        state: 'ready',
        docs: stats.docs,
        chunks: stats.chunks,
      });
    } catch (err) {
      this.status$.next({
        state: 'error',
        error: err instanceof Error ? err.message : 'Indexing failed',
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * Mean-of-chunk-embeddings for a text, re-normalized to unit length;
   * null when the text is empty (no signal).
   */
  private async textCentroid(text: string): Promise<number[] | null> {
    const chunks = chunkText(text).slice(0, 4);
    if (chunks.length === 0) return null;
    const embeddings = await this.embedding.embed(chunks);
    const dim = embeddings[0]?.length ?? 0;
    if (!dim) return null;
    const mean = new Array<number>(dim).fill(0);
    for (const embedding of embeddings) {
      for (let i = 0; i < dim; i++) mean[i] += embedding[i];
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      mean[i] /= embeddings.length;
      norm += mean[i] * mean[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) mean[i] /= norm;
    return mean;
  }

  private docTitle(docId: string): string {
    return (
      this.docsService.list.docsMap$.value
        .get(docId)
        ?.meta$.value.title?.trim() ?? ''
    );
  }

  /** Per-doc title/body vectors, cached across one scan. */
  private async docSignals(
    docId: string,
    cache: Map<string, DocSignals>
  ): Promise<DocSignals> {
    let signals = cache.get(docId);
    if (!signals) {
      const title = this.docTitle(docId);
      signals = {
        title: title ? await this.embedding.embedOne(title) : null,
        body: await this.textCentroid(await this.docText(docId)),
      };
      cache.set(docId, signals);
    }
    return signals;
  }

  /**
   * Title+body-aware similarity for merge suggestions. The chunk index's
   * best-chunk score over-weights titles (the first chunk starts with
   * `# Title`, so two short notes sharing a title look ~100% similar);
   * here title and body are compared separately and combined 30/70, so a
   * shared title alone can't mark two different notes as duplicates.
   * Missing sides give no signal (both bodies empty → title decides, one
   * body empty → the bodies genuinely differ → 0 for that component).
   */
  async pairSimilarity(
    aDocId: string,
    bDocId: string,
    cache: Map<string, DocSignals>
  ): Promise<number | null> {
    return combineTitleBodyScore(
      await this.docSignals(aDocId, cache),
      await this.docSignals(bDocId, cache)
    );
  }

  /** Semantic search: embed the query, return the top-k matching chunks. */
  async search(query: string, topK = 5): Promise<VectorSearchResult[]> {
    const text = query.trim();
    if (!text) return [];
    const embedding = await this.embedding.embedOne(text);
    return this.store.search(embedding, topK);
  }

  /**
   * Find docs related to `docId` by embedding similarity. Uses the doc's stored
   * chunk vectors as queries (embedding it on the fly if it isn't indexed yet),
   * searches the index, and aggregates the best score per other doc.
   */
  async findRelatedDocs(docId: string, topK = 5): Promise<RelatedDoc[]> {
    let queries: { embedding: number[] }[] =
      await this.store.getDocChunks(docId);
    if (queries.length === 0) {
      const chunks = chunkText(await this.docText(docId));
      if (chunks.length === 0) return [];
      const embeddings = await this.embedding.embed(chunks.slice(0, 4));
      queries = embeddings.map(embedding => ({ embedding }));
    }

    const best = new Map<string, { score: number; snippet: string }>();
    for (const query of queries) {
      for (const result of await this.store.search(query.embedding, topK + 5)) {
        if (result.docId === docId) continue;
        const current = best.get(result.docId);
        if (!current || result.score > current.score) {
          best.set(result.docId, {
            score: result.score,
            snippet: result.text,
          });
        }
      }
    }

    return [...best.entries()]
      .map(([id, value]) => ({ docId: id, ...value }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

export interface RelatedDoc {
  docId: string;
  score: number;
  snippet: string;
}

/** Unit vectors for a doc's title and body; null = that side has no text. */
export interface DocSignals {
  title: number[] | null;
  body: number[] | null;
}

/**
 * Combines separate title and body similarities into one merge score,
 * weighted 30/70 toward the body. A side where both docs are empty gives
 * no signal (the other side decides alone); a side where exactly one doc
 * is empty scores 0 — the docs genuinely differ there. Returns null when
 * neither side has any signal.
 */
export function combineTitleBodyScore(
  a: DocSignals,
  b: DocSignals
): number | null {
  const cosine = (x: number[], y: number[]) => {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * y[i];
    return sum;
  };
  const titleScore =
    a.title && b.title
      ? cosine(a.title, b.title)
      : !a.title && !b.title
        ? null
        : 0;
  const bodyScore =
    a.body && b.body
      ? cosine(a.body, b.body)
      : !a.body && !b.body
        ? null
        : 0;
  if (titleScore === null && bodyScore === null) return null;
  if (bodyScore === null) return titleScore;
  if (titleScore === null) return bodyScore;
  return 0.3 * titleScore + 0.7 * bodyScore;
}

export interface MergeSuggestion {
  aDocId: string;
  bDocId: string;
  score: number;
  snippet: string;
}

/**
 * Workspace-wide near-duplicate detection over the local index. Two
 * stages: the chunk index shortlists candidate pairs cheaply (generous
 * threshold — its best-chunk score over-weights titles), then each
 * candidate is re-scored with the title/body-aware {@link
 * DocEmbedder.pairSimilarity} so only genuinely similar notes survive.
 * On-demand (not reactive).
 */
export async function findMergeablePairs(
  embedder: DocEmbedder,
  threshold = 0.82,
  limit = 15
): Promise<MergeSuggestion[]> {
  const ids = await embedder.store.embeddedDocIds();
  const seen = new Set<string>();
  const candidates: MergeSuggestion[] = [];
  const shortlistThreshold = Math.min(threshold, 0.7);
  for (const id of ids) {
    for (const related of await embedder.findRelatedDocs(id, 3)) {
      if (related.score < shortlistThreshold) continue;
      const key = [id, related.docId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        aDocId: id,
        bDocId: related.docId,
        score: related.score,
        snippet: related.snippet,
      });
    }
  }

  const signalCache = new Map<
    string,
    { title: number[] | null; body: number[] | null }
  >();
  const pairs: MergeSuggestion[] = [];
  for (const candidate of candidates) {
    const score = await embedder.pairSimilarity(
      candidate.aDocId,
      candidate.bDocId,
      signalCache
    );
    if (score === null || score < threshold) continue;
    pairs.push({ ...candidate, score });
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, limit);
}
