import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { LiveData, Service } from '@notesgraph/infra';

export type LocalEmbeddingStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number; text: string }
  | { state: 'ready' }
  | { state: 'error'; error: string };

/** Small sentence-embedding model (~30 MB), 384-dim, good enough for doc RAG. */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

/**
 * On-device text embeddings via transformers.js (ONNX, WASM/WebGPU). Lazy-
 * `import()`ed so nothing lands in the main bundle; weights download once and
 * are cached by the browser. Runs on the main thread for now (a worker is a
 * follow-up, same as the LLM).
 */
export class LocalEmbeddingService extends Service {
  readonly status$ = new LiveData<LocalEmbeddingStatus>({ state: 'idle' });
  private extractor: FeatureExtractionPipeline | null = null;
  private loadPromise: Promise<FeatureExtractionPipeline> | null = null;

  get ready() {
    return this.extractor !== null;
  }

  async ensureLoaded(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) return this.extractor;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        this.status$.next({ state: 'loading', progress: 0, text: 'Starting…' });
        try {
          await navigator.storage?.persist?.();
        } catch {
          /* not fatal */
        }
        const { env, pipeline } = await import('@huggingface/transformers');
        // Browser: always fetch weights from the HF hub (no local /models path).
        env.allowLocalModels = false;
        const extractor = await pipeline(
          'feature-extraction',
          EMBEDDING_MODEL,
          {
            progress_callback: (report: {
              status?: string;
              file?: string;
              progress?: number;
            }) => {
              this.status$.next({
                state: 'loading',
                progress:
                  typeof report.progress === 'number'
                    ? report.progress / 100
                    : 0,
                text: report.file ?? report.status ?? '',
              });
            },
          }
        );
        this.extractor = extractor;
        this.status$.next({ state: 'ready' });
        return extractor;
      } catch (err) {
        const error =
          err instanceof Error ? err.message : 'Embedding model load failed';
        this.status$.next({ state: 'error', error });
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  /** Embed a batch of texts → unit-normalized 384-d vectors. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.ensureLoaded();
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist() as number[][];
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector;
  }
}
