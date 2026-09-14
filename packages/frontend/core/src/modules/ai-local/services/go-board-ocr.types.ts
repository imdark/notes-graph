import type { OpSchema } from '@notesgraph/infra/op';

import type { Board } from '../utils/sgf';

export type GoBoardOcrStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; error: string };

export interface GoBoardDetection {
  /** Board size (e.g. 9, 13, 19). */
  size: number;
  /** SGF for the detected position (setup stones). */
  sgf: string;
  /** `board[row][col]` matrix of empty/black/white. */
  board: Board;
  /** Rough 0–1 confidence in the read (low → tell the user to spot-check). */
  confidence: number;
}

/**
 * RPC contract between {@link GoBoardOcrService} (main thread) and the
 * `go-board-ocr.worker` backend. `init` loads OpenCV.js inside the worker;
 * `detect` runs the classical-CV pipeline on an image blob. Shared as a
 * type-only module so the worker bundle never pulls in `Service`/DOM code.
 */
export interface GoBoardOcrOps extends OpSchema {
  init: [void, { ok: true }];
  detect: [Blob, GoBoardDetection];
}
