// Types for a plugin's optional `server.js`, run by the marketplace sidecar in
// an isolated worker. DOM-free so the sidecar (node) can import it.

export interface PluginServerContext {
  readonly pluginId: string;
  /** Per-plugin key/value store (JSON values), persisted by the sidecar. */
  readonly kv: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /** Per-plugin binary store. */
  readonly blob: {
    put(key: string, data: Uint8Array): Promise<void>;
    get(key: string): Promise<Uint8Array | undefined>;
    delete(key: string): Promise<void>;
  };
  /** Secrets configured for the plugin (never exposed to the client). */
  readonly secrets: Record<string, string | undefined>;
  fetch(url: string, init?: unknown): Promise<unknown>;
  log(...args: unknown[]): void;
}

export interface PluginRequest {
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

export type PluginFunctionHandler = (
  req: PluginRequest,
  ctx: PluginServerContext
) => unknown | Promise<unknown>;

export interface CronSpec {
  /** Standard cron expression, e.g. `0 * * * *`. */
  schedule: string;
  /** Name of a handler in `functions`. */
  handler: string;
}

export interface PluginServerDefinition {
  /** Callable via the client's `backend.invoke(name, payload)`. */
  functions?: Record<string, PluginFunctionHandler>;
  cron?: CronSpec[];
  onQueue?: Record<string, PluginFunctionHandler>;
  onWebhook?: PluginFunctionHandler;
}

/** Identity helper a plugin's server entry exports as `default`. */
export function defineServer(
  def: PluginServerDefinition
): PluginServerDefinition {
  return def;
}
