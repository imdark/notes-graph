import type { MessageCommunicapable } from '@notesgraph/infra/op';
import { OpConsumer } from '@notesgraph/infra/op';

import { BLACK, type Board, boardToSgf, EMPTY, WHITE } from '../utils/sgf';
import type { GoBoardDetection, GoBoardOcrOps } from './go-board-ocr.types';

/**
 * On-device Go-board reader. Two stages, both local:
 *  1. GRID — projection-profile + autocorrelation finds the board lattice. A
 *     diagram's grid is perfectly periodic, so the autocorrelation of the
 *     darkness projection gives the exact pitch (immune to the dense-stone /
 *     coordinate-label noise that defeats Hough-line clustering), and a comb
 *     correlation locks the phase. No OpenCV needed.
 *  2. STONES — a fine-tuned YOLOv8n-cls classifier (vendored ONNX, run via
 *     onnxruntime-web) labels a 64×64 patch at every intersection as
 *     empty/black/white. Trained on synthetic board renders, so it reads
 *     printed diagrams robustly where brightness thresholds failed.
 */

// Vendored model — emitted as an asset, fetched at runtime.
const MODEL_URL = new URL(
  '../vendor/go-board/stone-classifier.onnx',
  import.meta.url
);
// onnxruntime-web wasm (same CDN the local-image/vision services use).
const ORT_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
// ONNX class indices: 0 = black, 1 = empty, 2 = white.
const CLS_BLACK = 0;
const CLS_WHITE = 2;
const PATCH = 64;
const STANDARD_SIZES = [9, 13, 19];

interface OrtTensor {
  data: Float32Array;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  inputNames: string[];
  outputNames: string[];
}
interface Ort {
  env: { wasm: { wasmPaths: string; numThreads?: number } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(
      model: Uint8Array,
      options?: Record<string, unknown>
    ): Promise<OrtSession>;
  };
}

class GoBoardOcrBackend extends OpConsumer<GoBoardOcrOps> {
  private ort: Ort | null = null;
  private session: OrtSession | null = null;
  private loadPromise: Promise<OrtSession> | null = null;

  constructor(port: MessageCommunicapable) {
    super(port);
    this.register('init', this.init.bind(this));
    this.register('detect', this.detect.bind(this));
  }

  private ensureModel(): Promise<OrtSession> {
    if (this.session) return Promise.resolve(this.session);
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const ort = (await import('onnxruntime-web')) as unknown as Ort;
        ort.env.wasm.wasmPaths = ORT_WASM_BASE;
        const buf = await (await fetch(MODEL_URL)).arrayBuffer();
        const session = await ort.InferenceSession.create(new Uint8Array(buf), {
          executionProviders: ['wasm'],
        });
        this.ort = ort;
        this.session = session;
        console.info('[go-ocr] stone classifier loaded');
        return session;
      })().catch(err => {
        this.loadPromise = null;
        throw err;
      });
    }
    return this.loadPromise;
  }

  async init(): Promise<{ ok: true }> {
    await this.ensureModel();
    return { ok: true };
  }

  async detect(image: Blob): Promise<GoBoardDetection> {
    await this.ensureModel();
    const { bitmap, gray, width, height } = await decode(image);
    try {
      const { cols, rows, size } = projectionGrid(gray, width, height);
      console.info(
        '[go-ocr] grid — size',
        size,
        'pitch',
        Math.round((cols[size - 1] - cols[0]) / Math.max(1, size - 1)),
        'vO',
        Math.round(cols[0]),
        'hO',
        Math.round(rows[0])
      );
      const { board, confidence } = await this.classify(
        bitmap,
        cols,
        rows,
        size
      );
      return { size, sgf: boardToSgf(board, size), board, confidence };
    } finally {
      bitmap.close();
    }
  }

  /** Crop a 64×64 patch at each intersection and run the ONNX classifier. */
  private async classify(
    bitmap: ImageBitmap,
    cols: number[],
    rows: number[],
    size: number
  ): Promise<{ board: Board; confidence: number }> {
    const ort = this.ort;
    const session = this.session;
    if (!ort || !session) throw new Error('Classifier not loaded');
    const spacing = (cols[size - 1] - cols[0]) / Math.max(1, size - 1);
    const half = Math.max(8, Math.round((spacing * 1.2) / 2));
    const canvas = new OffscreenCanvas(PATCH, PATCH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D canvas context');

    const board: Board = rows.map(() => cols.map(() => EMPTY));
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const plane = PATCH * PATCH;
    const buf = new Float32Array(3 * plane);
    let clear = 0;
    let count = 0;
    for (let ri = 0; ri < size; ri++) {
      for (let ci = 0; ci < size; ci++) {
        ctx.clearRect(0, 0, PATCH, PATCH);
        ctx.drawImage(
          bitmap,
          cols[ci] - half,
          rows[ri] - half,
          half * 2,
          half * 2,
          0,
          0,
          PATCH,
          PATCH
        );
        const { data } = ctx.getImageData(0, 0, PATCH, PATCH);
        // RGBA → CHW RGB, normalized to [0,1].
        for (let p = 0; p < plane; p++) {
          buf[p] = data[p * 4] / 255;
          buf[plane + p] = data[p * 4 + 1] / 255;
          buf[2 * plane + p] = data[p * 4 + 2] / 255;
        }
        const tensor = new ort.Tensor('float32', buf.slice(), [
          1,
          3,
          PATCH,
          PATCH,
        ]);
        const out = await session.run({ [inputName]: tensor });
        const logits = out[outputName].data;
        let best = 0;
        for (let k = 1; k < logits.length; k++) {
          if (logits[k] > logits[best]) best = k;
        }
        if (best === CLS_BLACK) board[ri][ci] = BLACK;
        else if (best === CLS_WHITE) board[ri][ci] = WHITE;
        // confidence: margin between the top logit and the runner-up.
        const sorted = [...logits].sort((a, b) => b - a);
        if (sorted[0] - sorted[1] > 1) clear++;
        count++;
      }
    }
    return { board, confidence: count > 0 ? clear / count : 0 };
  }
}

/** Decode a blob to RGBA bitmap + grayscale, downscaled so detection stays fast. */
async function decode(
  blob: Blob,
  maxDim = 1280
): Promise<{
  bitmap: ImageBitmap;
  gray: Float32Array;
  width: number;
  height: number;
}> {
  const src = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    src.close();
    throw new Error('Could not get a 2D canvas context');
  }
  ctx.drawImage(src, 0, 0, width, height);
  src.close();
  const bitmap = await createImageBitmap(canvas);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return { bitmap, gray, width, height };
}

/** Sum of darkness (255 - gray) per column and per row. */
function darknessProfiles(
  gray: Float32Array,
  width: number,
  height: number
): { col: Float32Array; row: Float32Array } {
  const col = new Float32Array(width);
  const row = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = 255 - gray[y * width + x];
      col[x] += d;
      row[y] += d;
    }
  }
  return { col, row };
}

/** Dominant period of a 1-D signal via autocorrelation, within [lo, hi]. */
function autocorrPitch(s: Float32Array, lo: number, hi: number): number {
  const n = s.length;
  // High-pass (subtract box-smoothed copy) then de-mean.
  const k = 41;
  const sm = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += s[i];
    if (i >= k) acc -= s[i - k];
    sm[i] = acc / Math.min(k, i + 1);
  }
  const half = (k - 1) / 2;
  const d = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    d[i] = s[i] - sm[Math.min(n - 1, i + half)];
    mean += d[i];
  }
  mean /= n;
  for (let i = 0; i < n; i++) d[i] -= mean;
  let bestLag = lo;
  let bestVal = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    let v = 0;
    for (let i = 0; i + lag < n; i++) v += d[i] * d[i + lag];
    if (v > bestVal) {
      bestVal = v;
      bestLag = lag;
    }
  }
  return bestLag;
}

/**
 * Find the phase (comb offset collecting the most darkness) and the `size`
 * consecutive grid lines with the most darkness (= the board). `score` is the
 * minimum darkness across the chosen lines — high only when every line lands on
 * a real grid line, so it doubles as a board-size goodness measure.
 */
function fitAxis(
  profile: Float32Array,
  pitch: number,
  size: number
): { lines: number[]; score: number } {
  const n = profile.length;
  const at = (x: number) => {
    const xi = Math.round(x);
    return xi >= 0 && xi < n ? profile[xi] : 0;
  };
  let bestPhi = 0;
  let bestPhiScore = -Infinity;
  for (let phi = 0; phi < pitch; phi += 0.25) {
    let sc = 0;
    for (let x = phi; x < n; x += pitch) sc += at(x);
    if (sc > bestPhiScore) {
      bestPhiScore = sc;
      bestPhi = phi;
    }
  }
  const all: number[] = [];
  for (let x = bestPhi; x < n; x += pitch) all.push(x);
  const vals = all.map(at);
  let bestStart = 0;
  let bestSum = -Infinity;
  let bestMin = 0;
  for (let s = 0; s + size <= all.length; s++) {
    let sum = 0;
    let mn = Infinity;
    for (let i = s; i < s + size; i++) {
      sum += vals[i];
      if (vals[i] < mn) mn = vals[i];
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = s;
      bestMin = mn;
    }
  }
  return { lines: all.slice(bestStart, bestStart + size), score: bestMin };
}

/**
 * Detect the full grid: autocorrelation pitch per axis, then pick the board size
 * (9/13/19) whose fitted lattice best lands on real grid lines.
 */
function projectionGrid(
  gray: Float32Array,
  width: number,
  height: number
): { cols: number[]; rows: number[]; size: number } {
  const { col, row } = darknessProfiles(gray, width, height);
  const px = autocorrPitch(col, 12, Math.round(width / 9));
  const py = autocorrPitch(row, 12, Math.round(height / 9));

  let best: { cols: number[]; rows: number[]; size: number; score: number } = {
    cols: [],
    rows: [],
    size: 19,
    score: -Infinity,
  };
  for (const size of STANDARD_SIZES) {
    const c = fitAxis(col, px, size);
    const r = fitAxis(row, py, size);
    if (c.lines.length < size || r.lines.length < size) continue;
    const score = Math.min(c.score, r.score);
    if (score > best.score)
      best = { cols: c.lines, rows: r.lines, size, score };
  }
  if (best.cols.length === 0) {
    // Fallback: assume 19, span the image with small margins.
    const size = 19;
    const m = 0.06;
    const cols = Array.from(
      { length: size },
      (_, k) => width * m + (k * width * (1 - 2 * m)) / (size - 1)
    );
    const rows = Array.from(
      { length: size },
      (_, k) => height * m + (k * height * (1 - 2 * m)) / (size - 1)
    );
    return { cols, rows, size };
  }
  return { cols: best.cols, rows: best.rows, size: best.size };
}

console.info('[go-ocr] worker booted');
new GoBoardOcrBackend(self as MessageCommunicapable);
