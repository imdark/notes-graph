import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { UA } from './constants';
import type { ExtractOptions, LinkPreview } from './types';

function absUrl(
  href: string | undefined | null,
  base: string
): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

function truncate(value: string | undefined | null, max: number): string {
  const t = (value ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: ac.signal,
    });
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Meta {
  ogTitle?: string;
  ogImage?: string;
  desc?: string;
  siteName?: string;
  icon?: string;
}

function parseMeta(html: string, baseUrl: string): Meta {
  const { document } = parseHTML(html);
  const metaContent = (selector: string) =>
    document.querySelector(selector)?.getAttribute('content') ?? undefined;
  const linkHref = (selector: string) =>
    document.querySelector(selector)?.getAttribute('href') ?? undefined;
  return {
    ogTitle:
      metaContent('meta[property="og:title"]') ??
      metaContent('meta[name="twitter:title"]'),
    ogImage: absUrl(
      metaContent('meta[property="og:image"]') ??
        metaContent('meta[name="twitter:image"]'),
      baseUrl
    ),
    desc:
      metaContent('meta[property="og:description"]') ??
      metaContent('meta[name="description"]'),
    siteName: metaContent('meta[property="og:site_name"]'),
    icon: absUrl(
      linkHref('link[rel="apple-touch-icon"]') ??
        linkHref('link[rel="apple-touch-icon-precomposed"]') ??
        linkHref('link[rel~="icon"]'),
      baseUrl
    ),
  };
}

interface Article {
  title?: string;
  excerpt?: string;
  textContent?: string;
  siteName?: string;
}

function readArticle(html: string): Article | null {
  try {
    const { document } = parseHTML(html);
    return new Readability(
      document as unknown as Document
    ).parse() as Article | null;
  } catch {
    return null;
  }
}

/**
 * Extract page metadata for the card / link preview. Network is injected so the
 * host enforces its own policy (SSRF guard in the sidecar, plain fetch in
 * Electron). `renderHtml` is an optional host fallback for JS-heavy pages.
 */
export async function extract(
  url: string,
  opts: ExtractOptions = {}
): Promise<LinkPreview> {
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20000;

  let html = await fetchHtml(url, fetchImpl, timeoutMs);
  let meta: Meta = html ? parseMeta(html, url) : {};
  let article: Article | null = html ? readArticle(html) : null;

  if ((article?.textContent?.trim().length ?? 0) < 200 && opts.renderHtml) {
    const rendered = await opts.renderHtml(url).catch(() => null);
    if (rendered) {
      html = rendered;
      meta = { ...meta, ...parseMeta(rendered, url) };
      article = readArticle(rendered) ?? article;
    }
  }

  const domain = new URL(url).hostname.replace(/^www\./, '');
  return {
    url,
    domain,
    title: truncate(meta.ogTitle ?? article?.title ?? domain, 95) || domain,
    excerpt: truncate(
      article?.excerpt ?? meta.desc ?? article?.textContent ?? '',
      165
    ),
    siteName: meta.siteName ?? article?.siteName ?? domain,
    image: meta.ogImage,
    // Fall back to the well-known /favicon.ico when no <link rel="icon">.
    icon: meta.icon ?? faviconFallback(url),
  };
}

function faviconFallback(url: string): string | undefined {
  try {
    return new URL(url).origin + '/favicon.ico';
  } catch {
    return undefined;
  }
}
