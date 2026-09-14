export type ClipMode = 'card' | 'screenshot';

/** Extracted page metadata, used both for the card render and link previews. */
export interface LinkPreview {
  url: string;
  domain: string;
  title: string;
  excerpt: string;
  siteName: string;
  /** absolute hero image URL (og:image) */
  image?: string;
  /** absolute favicon / touch-icon URL */
  icon?: string;
}

/** Fetch + optional SPA fallback, supplied by the host (sidecar / electron). */
export interface ExtractOptions {
  /** defaults to global fetch */
  fetch?: typeof fetch;
  /** host-provided renderer for JS-heavy pages (Playwright / Electron window) */
  renderHtml?: (url: string) => Promise<string | null>;
  timeoutMs?: number;
}

export interface RenderCardOptions extends ExtractOptions {
  /** JPEG quality 1-100 */
  quality?: number;
}
