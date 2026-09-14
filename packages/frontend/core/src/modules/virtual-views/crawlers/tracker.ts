import type { Crawler, CrawlSample } from './def';
import { proxyFetchText } from './xml';

/** Extract a number from page HTML: custom pattern → JSON-LD price → currency. */
function extractNumber(html: string, pattern?: string): number | null {
  const parse = (raw: string): number | null => {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  if (pattern) {
    try {
      const m = html.match(new RegExp(pattern));
      const captured = m?.[1] ?? m?.[0];
      if (captured != null) return parse(captured);
    } catch {
      throw new Error('Invalid extraction pattern (not a valid regexp)');
    }
    return null;
  }

  // JSON-LD / microdata price, e.g. "price": "19.99" or "price":19.99
  const jsonLd = html.match(/"price"\s*:\s*"?([\d,]+(?:\.\d+)?)"?/i);
  if (jsonLd) return parse(jsonLd[1]);

  // Currency-prefixed amount, e.g. $1,299.00 / €19,99 / £5
  const currency = html.match(/[$€£¥]\s?([\d.,]+)/);
  if (currency) return parse(currency[1]);

  return null;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Tracks a single numeric value on a web page over time (product price,
 * mortgage rate, …). `sample` extracts the current value from the page HTML;
 * the service appends it to a history and fires an alert when it crosses a
 * configured threshold. Reads raw (server-rendered / JSON-LD) HTML through the
 * sidecar proxy — pages that render the value only via client-side JS won't
 * expose it here.
 */
export const trackerCrawler: Crawler = {
  type: 'tracker',
  kind: 'timeseries',

  async parse(input) {
    const url = input.trim();
    if (!/^https?:\/\//.test(url)) {
      throw new Error('Enter a full page URL (https://…)');
    }
    return { config: { url }, name: hostname(url) };
  },

  async sample(config): Promise<CrawlSample> {
    const url = String(config.url ?? '');
    if (!url) {
      throw new Error('Invalid tracker config');
    }
    const pattern = config.pattern ? String(config.pattern) : undefined;
    const html = await proxyFetchText(url);
    const value = extractNumber(html, pattern);
    if (value == null) {
      throw new Error('Could not find a value on that page');
    }
    return { value, unit: config.unit ? String(config.unit) : undefined };
  },
};
