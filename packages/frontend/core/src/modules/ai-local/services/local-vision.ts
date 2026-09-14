import type { ImageToTextPipeline } from '@huggingface/transformers';
import { LiveData, Service } from '@notesgraph/infra';

export type LocalVisionStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number; text: string }
  | { state: 'ready' }
  | { state: 'error'; error: string };

/**
 * ViT-GPT2 image-captioning model — the reference transformers.js captioner.
 * Describes an image in a sentence, enough to let the text LLM answer "explain
 * this image" on-device. Loaded int8-quantized (`q8`) to keep the download
 * ~250 MB and fast on WASM (fp32 weights are ~900 MB).
 */
export const CAPTION_MODEL = 'Xenova/vit-gpt2-image-captioning';

/**
 * On-device image understanding via transformers.js (ONNX, WASM/WebGPU). The
 * local chat model is text-only, so to support image actions ("Explain this
 * image") we caption the image here and feed the caption to the LLM. Lazy-
 * `import()`ed so nothing lands in the main bundle; weights download once and
 * are cached by the browser.
 */
export class LocalVisionService extends Service {
  readonly status$ = new LiveData<LocalVisionStatus>({ state: 'idle' });
  private captioner: ImageToTextPipeline | null = null;
  private loadPromise: Promise<ImageToTextPipeline> | null = null;

  get ready() {
    return this.captioner !== null;
  }

  async ensureLoaded(): Promise<ImageToTextPipeline> {
    if (this.captioner) return this.captioner;
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
        const captioner = await pipeline('image-to-text', CAPTION_MODEL, {
          dtype: 'q8',
          // onnxruntime-web 1.27's extended optimizer trips on this model's
          // tied, int8-quantized word embeddings — "Missing required scale …
          // TransposeDQWeightsForMatMulNBits". That QDQ→MatMulNBits fusion is an
          // extended-level pass; disable graph optimization so the QDQ nodes run
          // unfused (correctness unchanged) and the session builds.
          session_options: { graphOptimizationLevel: 'disabled' },
          progress_callback: (report: {
            status?: string;
            file?: string;
            progress?: number;
          }) => {
            this.status$.next({
              state: 'loading',
              progress:
                typeof report.progress === 'number' ? report.progress / 100 : 0,
              text: report.file ?? report.status ?? '',
            });
          },
        });
        this.captioner = captioner;
        this.status$.next({ state: 'ready' });
        return captioner;
      } catch (err) {
        const error =
          err instanceof Error ? err.message : 'Vision model load failed';
        this.status$.next({ state: 'error', error });
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  /** Describe an image (Blob/File) in a short sentence. */
  async caption(image: Blob): Promise<string> {
    const captioner = await this.ensureLoaded();
    const { RawImage } = await import('@huggingface/transformers');
    const raw = await RawImage.fromBlob(image);
    const output = (await captioner(raw)) as Array<{ generated_text?: string }>;
    return (output[0]?.generated_text ?? '').trim();
  }
}
