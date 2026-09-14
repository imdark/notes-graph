/** A crawled external item (e.g. a video, message, file). */
export interface CrawledItem {
  /** Stable id within the source (e.g. YouTube video id). */
  externalId: string;
  title: string;
  url: string;
  snippet?: string;
  thumbnail?: string;
  publishedAt?: number;
}

export interface CrawlResult {
  /** Resolved display name for the view (e.g. the channel title). */
  name?: string;
  items: CrawledItem[];
}

/** A single reading for a `timeseries` crawler (e.g. a price). */
export interface CrawlSample {
  value: number;
  /** Optional display unit/currency, e.g. "$" or "%". */
  unit?: string;
}

/**
 * A crawler fetches the current contents of an external resource. Crawlers are
 * pure fetch+parse — persistence, scheduling, alerts and indexing live in the
 * service.
 *
 * - `list` crawlers (default) return a full set of items each crawl.
 * - `timeseries` crawlers return one numeric reading, appended to a history
 *   (e.g. a product price or a mortgage rate over time).
 */
export interface Crawler {
  /** Matches `virtualViews.type`. */
  readonly type: string;
  readonly kind?: 'list' | 'timeseries';
  /**
   * Turn single-string user input (a URL / handle / id) into the config stored
   * on the view. Optional — crawlers with structured credentials (IMAP, Gmail)
   * are added via dedicated service methods instead.
   */
  parse?(input: string): Promise<{ config: Record<string, unknown>; name?: string }>;
  /** For `list` crawlers. */
  crawl?(config: Record<string, unknown>): Promise<CrawlResult>;
  /** For `timeseries` crawlers. */
  sample?(config: Record<string, unknown>): Promise<CrawlSample>;
}
