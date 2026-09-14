const DEFAULT_MARKETPLACE_URL = 'http://localhost:8099';
const OVERRIDE_KEY = 'notesgraph:pluginMarketplaceBaseUrl';

/**
 * Base URL of the plugin marketplace sidecar (default :8099, overridable via
 * `localStorage['notesgraph:pluginMarketplaceBaseUrl']`).
 */
export function getPluginMarketplaceBaseUrl(): string {
  try {
    const override = globalThis.localStorage?.getItem(OVERRIDE_KEY);
    if (override) return override.replace(/\/+$/, '');
  } catch {
    // localStorage may be unavailable — fall through
  }
  return DEFAULT_MARKETPLACE_URL;
}

export interface MarketplaceEntry {
  id: string;
  version: string;
  name: string;
  description?: string;
  author?: string;
  platforms: string[];
  permissions: string[];
  hasServer: boolean;
  /** Relative download base, e.g. `/download/:id/:version`. */
  downloadUrl: string;
}

/** Absolute base URL the client loads a marketplace plugin from. */
export function marketplaceDownloadUrl(entry: MarketplaceEntry): string {
  return `${getPluginMarketplaceBaseUrl()}${entry.downloadUrl}`;
}
