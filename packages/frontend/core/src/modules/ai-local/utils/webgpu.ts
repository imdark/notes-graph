export interface WebGPUCapability {
  available: boolean;
  reason?: string;
}

let cached: Promise<WebGPUCapability> | null = null;

/**
 * Probe for usable WebGPU (required for on-device chat / image models). Result
 * is cached for the session. Embeddings / STT can fall back to WASM, but chat
 * is impractical without WebGPU.
 */
export function detectWebGPU(): Promise<WebGPUCapability> {
  if (cached) return cached;
  cached = (async (): Promise<WebGPUCapability> => {
    const gpu = (
      navigator as unknown as {
        gpu?: { requestAdapter(): Promise<unknown> };
      }
    ).gpu;
    if (!gpu) {
      return { available: false, reason: 'WebGPU is not supported here' };
    }
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        return { available: false, reason: 'No suitable GPU adapter found' };
      }
      return { available: true };
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : 'WebGPU init failed',
      };
    }
  })();
  return cached;
}
