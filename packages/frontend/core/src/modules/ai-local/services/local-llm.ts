import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm';
import { LiveData, Service } from '@notesgraph/infra';

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LocalLLMStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number; text: string }
  | { state: 'ready' }
  | { state: 'error'; error: string };

/** Small instruction model that fits typical laptop GPUs; ~0.9 GB download. */
export const DEFAULT_LOCAL_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

/**
 * Chat models require a single system prompt as the first message — collapse
 * any system messages into one at the front so callers can't trip the template.
 */
function normalizeMessages(messages: LocalChatMessage[]): LocalChatMessage[] {
  const systems = messages.filter(m => m.role === 'system');
  if (systems.length === 0) return messages;
  const rest = messages.filter(m => m.role !== 'system');
  return [
    { role: 'system', content: systems.map(s => s.content).join('\n\n') },
    ...rest,
  ];
}

/**
 * Runs a quantized chat model on-device via WebLLM (WebGPU). The model + its
 * runtime are lazy-`import()`ed so nothing lands in the main bundle, and the
 * weights download once (cached by the browser).
 *
 * v1 runs on the main thread (simplest, no worker build entry); generation
 * yields between tokens so the UI stays responsive. A dedicated worker is a
 * follow-up.
 */
export class LocalLLMService extends Service {
  readonly status$ = new LiveData<LocalLLMStatus>({ state: 'idle' });
  private engine: MLCEngineInterface | null = null;
  private modelId: string | null = null;
  private loadPromise: Promise<void> | null = null;

  get currentModel() {
    return this.modelId;
  }

  async ensureLoaded(modelId: string = DEFAULT_LOCAL_MODEL): Promise<void> {
    if (this.engine && this.modelId === modelId) return;
    if (this.loadPromise && this.modelId === modelId) return this.loadPromise;
    this.modelId = modelId;
    this.loadPromise = (async () => {
      try {
        this.status$.next({ state: 'loading', progress: 0, text: 'Starting…' });
        // Ask the browser to keep the cached model weights — otherwise the
        // ~1 GB cache can be evicted between reloads, forcing a re-download.
        try {
          await navigator.storage?.persist?.();
        } catch {
          /* not fatal — caching still works, just evictable */
        }
        const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
        this.engine = await CreateMLCEngine(modelId, {
          initProgressCallback: (report: InitProgressReport) => {
            this.status$.next({
              state: 'loading',
              progress: report.progress,
              text: report.text,
            });
          },
        });
        this.status$.next({ state: 'ready' });
      } catch (err) {
        this.engine = null;
        this.modelId = null;
        const error = err instanceof Error ? err.message : 'Model load failed';
        this.status$.next({ state: 'error', error });
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  async *chatStream(
    messages: LocalChatMessage[],
    options?: { signal?: AbortSignal; temperature?: number; model?: string }
  ): AsyncGenerator<string> {
    // Loading a different model swaps the engine, so a caller that names one
    // (an agent with its own model) gets that model rather than whichever was
    // loaded last.
    await this.ensureLoaded(options?.model ?? DEFAULT_LOCAL_MODEL);
    const engine = this.engine;
    if (!engine) throw new Error('Local model is not loaded');
    const completion = await engine.chat.completions.create({
      messages: normalizeMessages(messages),
      stream: true,
      temperature: options?.temperature ?? 0.7,
    });
    for await (const chunk of completion) {
      if (options?.signal?.aborted) break;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** Non-streaming completion: collect the full reply. */
  async complete(
    messages: LocalChatMessage[],
    options?: { temperature?: number }
  ): Promise<string> {
    let text = '';
    for await (const token of this.chatStream(messages, options)) {
      text += token;
    }
    return text.trim();
  }

  async unload(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
      this.engine = null;
      this.modelId = null;
      this.status$.next({ state: 'idle' });
    }
  }
}
