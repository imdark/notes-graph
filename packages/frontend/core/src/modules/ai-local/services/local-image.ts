import { LiveData, Service } from '@notesgraph/infra';

export type LocalImageStatus =
  | { state: 'idle' }
  | { state: 'loading'; text: string; progress?: number }
  | { state: 'generating'; step: number; total: number }
  | { state: 'ready' }
  | { state: 'error'; error: string };

/**
 * Complete ONNX Latent-Consistency model (Dreamshaper v7) that runs in-browser
 * via WebGPU (~1.5 GB). LCM → fast (~8 steps). The SD-2.1 repo is broken (its
 * unet external-weights file is missing), so we use this instead.
 */
export const DEFAULT_IMAGE_MODEL = 'aislamov/lcm-dreamshaper-v7-onnx';

interface ImageTensor {
  dims: number[];
  data: Float32Array | number[];
}

interface ImageProgress {
  status: string;
  downloadStatus?: { file: string; size: number; downloaded: number };
  unetTimestep?: number;
  unetTotalSteps?: number;
}

interface ImagePipeline {
  run(input: {
    prompt: string;
    numInferenceSteps: number;
    guidanceScale?: number;
    width?: number;
    height?: number;
    progressCallback?: (progress: ImageProgress) => Promise<void>;
  }): Promise<ImageTensor[]>;
}

interface DiffusersModule {
  DiffusionPipeline: {
    fromPretrained(
      repo: string,
      options?: {
        progressCallback?: (progress: ImageProgress) => Promise<void>;
      }
    ): Promise<ImagePipeline>;
  };
}

function toByte(value: number, signed: boolean): number {
  const scaled = signed ? value / 2 + 0.5 : value;
  return Math.max(0, Math.min(255, Math.round(scaled * 255)));
}

/** Convert a CHW image tensor (values in [0,1] or [-1,1]) to a PNG blob. */
function tensorToBlob(tensor: ImageTensor): Promise<Blob | null> {
  const { dims, data } = tensor;
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  const plane = width * height;
  let min = Infinity;
  for (const value of data) if (value < min) min = value;
  const signed = min < -0.01;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    image.data[o] = toByte(data[i], signed);
    image.data[o + 1] = toByte(data[plane + i], signed);
    image.data[o + 2] = toByte(data[2 * plane + i], signed);
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise(resolve =>
    canvas.toBlob(blob => resolve(blob), 'image/png')
  );
}

/**
 * diffusers.js targets the `@aislamov/onnxruntime-web64` fork, which loads a
 * model's external weights from `{ externalWeights, externalWeightsFilename }`
 * fields it tucks inside each execution provider. The real `onnxruntime-web`
 * (rspack alias) ignores those and instead expects a top-level
 * `externalData: [{ path, data }]` session option — without it, deserializing a
 * model whose weights live in `model.onnx_data` fails with "Failed to load
 * external data file … MountedFiles is not available". Patch the shared
 * `InferenceSession.create` (the same class object diffusers calls) to
 * translate the fork's shape into the real one.
 */
/** The slice of an ORT module instance we configure + patch. */
interface OrtLike {
  env: { wasm: Record<string, unknown> };
  InferenceSession: unknown;
}

// Records what the external-data patch observed so a load failure can surface
// it in the user-visible error string — DevTools console isn't always at hand.
const imageDiag: {
  patchInstalled: boolean;
  creates: {
    providers: unknown;
    translated: { path: string; bytes: number }[];
  }[];
  instances?: number;
  tokenizerPatched?: boolean;
  tensorPatched?: boolean;
} = { patchInstalled: false, creates: [] };

// Distinct InferenceSession class objects we've already wrapped — keyed by the
// class itself so two ORT module instances each get patched exactly once (a
// single global flag would patch the first and silently skip the one diffusers
// actually calls).
const patchedSessions = new WeakSet<object>();
function patchOrtExternalData(ort: { InferenceSession: unknown }): void {
  const session = ort.InferenceSession as
    | { create?: (...args: unknown[]) => Promise<unknown> }
    | undefined;
  if (
    !session ||
    typeof session.create !== 'function' ||
    patchedSessions.has(session)
  ) {
    return;
  }
  patchedSessions.add(session);
  imageDiag.patchInstalled = true;
  interface ForkProvider {
    name?: string;
    externalWeights?: ArrayBuffer | Uint8Array;
    externalWeightsFilename?: string;
  }
  interface CreateOptions {
    executionProviders?: (string | ForkProvider)[];
    externalData?: { path: string; data: Uint8Array }[];
  }
  const original = session.create.bind(session) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  session.create = (...args: unknown[]) => {
    const options = args[1] as CreateOptions | undefined;
    const providers = options?.executionProviders;
    // Snapshot before we strip fields, so the log shows what diffusers passed.
    const before = Array.isArray(providers)
      ? providers.map(p =>
          typeof p === 'string'
            ? p
            : {
                name: p?.name,
                hasWeights: !!p?.externalWeights,
                weightsName: p?.externalWeightsFilename,
              }
        )
      : providers;
    const externalData: { path: string; data: Uint8Array }[] = [];
    if (options && Array.isArray(options.executionProviders)) {
      options.executionProviders = options.executionProviders.map(provider => {
        if (
          provider &&
          typeof provider === 'object' &&
          provider.externalWeights
        ) {
          const { externalWeights, externalWeightsFilename, ...rest } =
            provider;
          externalData.push({
            path: externalWeightsFilename ?? 'model.onnx_data',
            data:
              externalWeights instanceof Uint8Array
                ? externalWeights
                : new Uint8Array(externalWeights),
          });
          return rest;
        }
        return provider;
      });
      if (externalData.length > 0 && options.externalData == null) {
        options.externalData = externalData;
      }
    }
    const translated = externalData.map(e => ({
      path: e.path,
      bytes: e.data.byteLength,
    }));
    imageDiag.creates.push({ providers: before, translated });
    console.info('[ai-local] image: ORT create()', {
      providers: before,
      translated,
    });
    return original(...args);
  };
  console.info('[ai-local] image: ORT external-data patch installed');
}

interface XenovaTensor {
  view?: (...dims: number[]) => unknown;
  type: string;
  data: Float32Array;
  dims: number[];
}
type XenovaTensorCtor = new (
  type: string,
  data: unknown,
  dims: number[]
) => unknown;

/**
 * diffusers.js@0.9.3 was built against `@xenova/transformers` ~2.6, but the
 * resolved v2.17.2 changed two APIs it depends on. Reconcile them on the single
 * installed instance (the same one diffusers imports) before the pipeline runs:
 *
 *  - `PreTrainedTokenizer.prepare_model_inputs` — diffusers' `CLIPTokenizer`
 *    calls this hook during prompt encoding; v2.17.2 dropped it. Restore the
 *    upstream default (identity — `encodePrompt` only reads `input_ids` back).
 *  - `Tensor.reshape` / `Tensor.sqrt` — diffusers self-provides most Tensor math
 *    (add/sub/sin/cos/exp/pow/clipByValue…) but expects these two from the lib;
 *    v2.17.2 renamed `reshape`→`view` and has no `sqrt`. Add thin shims.
 */
function patchXenovaForDiffusers(xenova: unknown): {
  tokenizer: boolean;
  tensor: boolean;
} {
  const x = xenova as {
    PreTrainedTokenizer?: { prototype?: Record<string, unknown> };
    Tensor?: XenovaTensorCtor & { prototype: Record<string, unknown> };
  };
  let tokenizer = false;
  const tokProto = x.PreTrainedTokenizer?.prototype;
  if (tokProto && typeof tokProto.prepare_model_inputs !== 'function') {
    tokProto.prepare_model_inputs = (inputs: unknown) => inputs;
    tokenizer = true;
  }
  let tensor = false;
  const Tensor = x.Tensor;
  if (Tensor) {
    const proto = Tensor.prototype;
    if (typeof proto.reshape !== 'function') {
      proto.reshape = function (this: XenovaTensor, dims: number[]) {
        return typeof this.view === 'function'
          ? this.view(...dims)
          : new Tensor(this.type, this.data, dims);
      };
    }
    if (typeof proto.sqrt !== 'function') {
      proto.sqrt = function (this: XenovaTensor) {
        const data = this.data.slice();
        for (let i = 0; i < data.length; i++) data[i] = Math.sqrt(data[i]);
        return new Tensor(this.type, data, this.dims);
      };
    }
    tensor = true;
  }
  return { tokenizer, tensor };
}

/**
 * On-device text→image via a WebGPU ONNX Stable Diffusion pipeline
 * (`@aislamov/diffusers.js`). Lazy-loaded; the model (~1.5 GB) downloads once.
 * Experimental + VRAM-heavy — gated on WebGPU by callers.
 */
export class LocalImageService extends Service {
  readonly status$ = new LiveData<LocalImageStatus>({ state: 'idle' });
  private pipeline: ImagePipeline | null = null;
  private loadPromise: Promise<ImagePipeline> | null = null;

  async ensureLoaded(
    modelId: string = DEFAULT_IMAGE_MODEL
  ): Promise<ImagePipeline> {
    if (this.pipeline) return this.pipeline;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        this.status$.next({
          state: 'loading',
          text: 'Loading image model (~1.5 GB first time)…',
        });
        try {
          await navigator.storage?.persist?.();
        } catch {
          /* not fatal */
        }
        // diffusers.js resolves ORT as `(import * as ORT).default ?? ORT` from
        // the aliased `@aislamov/onnxruntime-web64`. Depending on how rspack
        // resolves the dynamic vs static import (the package's `import`,
        // `browser`, and `require` entries are three different files), that
        // object can differ from this module's `onnxruntime-web` named export —
        // which is why patching the named export never fired (`creates: []`).
        // Collect every reachable ORT instance (both specifiers, each unwrapped
        // `default ?? namespace`) and configure + patch all of them, so we
        // always hit the one the pipeline's sessions actually use. CDN wasmPaths
        // make the WebGPU glue (`…jsep.mjs` + `.wasm`) load immediately;
        // numThreads=1 avoids needing SharedArrayBuffer / COOP-COEP.
        const ortModules = await Promise.all([
          import('onnxruntime-web'),
          // Aliased to onnxruntime-web by rspack; imported by its own specifier
          // so we resolve the exact module instance diffusers.js uses. Not a
          // real dependency — the fork is aliased away, never bundled — so it's
          // intentionally absent from package.json.
          // eslint-disable-next-line import-x/no-extraneous-dependencies
          import('@aislamov/onnxruntime-web64') as Promise<unknown>,
        ]);
        const ortBase =
          'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
        const ortInstances = new Set<OrtLike>();
        for (const ns of ortModules) {
          for (const cand of [ns, (ns as { default?: unknown }).default]) {
            if (
              cand &&
              typeof cand === 'object' &&
              'InferenceSession' in cand
            ) {
              ortInstances.add(cand as OrtLike);
            }
          }
        }
        for (const inst of ortInstances) {
          inst.env.wasm.wasmPaths = {
            mjs: ortBase + 'ort-wasm-simd-threaded.jsep.mjs',
            wasm: ortBase + 'ort-wasm-simd-threaded.jsep.wasm',
          };
          inst.env.wasm.numThreads = 1;
          // Bridge diffusers.js's fork-style external weights to real ORT.
          patchOrtExternalData(inst);
        }
        imageDiag.instances = ortInstances.size;
        // Reconcile @xenova/transformers v2.17.2 with what diffusers.js@0.9.3
        // expects (missing tokenizer hook + renamed/removed Tensor methods), on
        // the same single installed instance diffusers imports, before it runs.
        // eslint-disable-next-line import-x/no-extraneous-dependencies
        const xenova = await import('@xenova/transformers');
        const xenovaPatched = patchXenovaForDiffusers(xenova);
        imageDiag.tokenizerPatched = xenovaPatched.tokenizer;
        imageDiag.tensorPatched = xenovaPatched.tensor;
        console.info('[ai-local] image: patched @xenova/transformers', {
          ...xenovaPatched,
        });
        // @ts-expect-error diffusers.js ships no ESM type declarations
        const diffusers = await import('@aislamov/diffusers.js');
        const mod = diffusers as unknown as DiffusersModule;
        const pipeline = await mod.DiffusionPipeline.fromPretrained(modelId, {
          progressCallback: async report => {
            if (report.downloadStatus) {
              const { file, downloaded, size } = report.downloadStatus;
              this.status$.next({
                state: 'loading',
                text: file,
                progress: size > 0 ? downloaded / size : undefined,
              });
            }
          },
        });
        this.pipeline = pipeline;
        this.status$.next({ state: 'ready' });
        return pipeline;
      } catch (err) {
        const base =
          err instanceof Error ? err.message : 'Image model load failed';
        // Append the patch's observations so the visible error is self-diagnosing.
        const error = `${base} [diag ${JSON.stringify(imageDiag)}]`;
        this.status$.next({ state: 'error', error });
        throw err;
      } finally {
        this.loadPromise = null;
      }
    })();
    return this.loadPromise;
  }

  async generate(
    prompt: string,
    options?: { steps?: number; width?: number; height?: number }
  ): Promise<Blob | null> {
    const pipeline = await this.ensureLoaded();
    const steps = options?.steps ?? 8; // LCM converges in few steps
    this.status$.next({ state: 'generating', step: 0, total: steps });
    const images = await pipeline.run({
      prompt,
      numInferenceSteps: steps,
      guidanceScale: 8.0,
      width: options?.width ?? 512,
      height: options?.height ?? 512,
      progressCallback: async report => {
        if (
          typeof report.unetTimestep === 'number' &&
          typeof report.unetTotalSteps === 'number'
        ) {
          this.status$.next({
            state: 'generating',
            step: report.unetTimestep,
            total: report.unetTotalSteps,
          });
        }
      },
    });
    this.status$.next({ state: 'ready' });
    const tensor = images[0];
    return tensor ? tensorToBlob(tensor) : null;
  }
}
