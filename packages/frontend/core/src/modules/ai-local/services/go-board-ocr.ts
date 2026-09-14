import { LiveData, Service } from '@notesgraph/infra';

import { WorkerOpRenderer } from '../../shared/worker-op-renderer';
import type {
  GoBoardDetection,
  GoBoardOcrOps,
  GoBoardOcrStatus,
} from './go-board-ocr.types';

export type { GoBoardDetection, GoBoardOcrStatus } from './go-board-ocr.types';

/** Reject if `promise` hasn't settled within `ms` — guards against a wedged worker. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/**
 * Main-thread handle to the `go-board-ocr` worker. OpenCV.js is a ~10 MB
 * single-file WASM build; loading and running it froze the UI thread, so all of
 * it lives in a worker (the same op-RPC pattern the mermaid/pdf/typst renderers
 * use). `init` triggers the lazy OpenCV load; `detect` runs the CV pipeline.
 */
class GoBoardOcrClient extends WorkerOpRenderer<GoBoardOcrOps> {
  constructor() {
    super('go-board-ocr');
  }

  init() {
    return this.ensureInitialized(() => this.call('init'));
  }

  detect(image: Blob): Promise<GoBoardDetection> {
    return this.call('detect', image);
  }
}

/**
 * On-device Go-board reader: turns a photo or a printed/screenshot diagram into
 * a board position (and SGF) using a classical OpenCV.js pipeline that runs in a
 * worker. No model download and no cloud calls; misreads on hard photos are
 * expected and corrected in the besogo widget the command inserts.
 */
export class GoBoardOcrService extends Service {
  readonly status$ = new LiveData<GoBoardOcrStatus>({ state: 'idle' });
  private client: GoBoardOcrClient | null = null;
  private loadPromise: Promise<void> | null = null;

  get ready() {
    return this.status$.value.state === 'ready';
  }

  /** Spin up the worker lazily — only when the feature is actually used. */
  private ensureClient(): GoBoardOcrClient {
    if (!this.client) {
      this.client = new GoBoardOcrClient();
    }
    return this.client;
  }

  /** Load OpenCV.js in the worker (idempotent); drives {@link status$}. */
  async ensureLoaded(): Promise<void> {
    if (this.status$.value.state === 'ready') return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        this.status$.next({ state: 'loading' });
        await withTimeout(
          this.ensureClient().init(),
          45_000,
          'OpenCV did not load within 45s — open DevTools and check the [go-ocr] worker logs / Network tab'
        );
        this.status$.next({ state: 'ready' });
      } catch (err) {
        // Tear down the (possibly wedged) worker so a retry starts from scratch.
        this.client?.destroy();
        this.client = null;
        const error =
          err instanceof Error ? err.message : 'OpenCV.js failed to load';
        this.status$.next({ state: 'error', error });
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  /** Detect the Go position in an image (Blob/File). */
  async detect(image: Blob): Promise<GoBoardDetection> {
    await this.ensureLoaded();
    return this.ensureClient().detect(image);
  }
}
