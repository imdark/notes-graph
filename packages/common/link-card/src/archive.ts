import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

/**
 * Pull the archivable content out of a page's HTML: the images and (best-effort)
 * video URLs a viewer would see, plus the full readable text. Pure + injectable
 * — the sidecar feeds it Playwright-rendered HTML so JS-built pages (LinkedIn/
 * Facebook) yield their real content; the caller downloads the returned media
 * and stores it as note blobs so it survives the original being deleted.
 *
 * Note on video: this returns direct `<video>/<source>`/`og:video` URLs only.
 * FB/LI stream video as chunked HLS/DASH behind `blob:`/signed CDN URLs, which
 * are NOT reachable here — those need authenticated client-side capture.
 */

export interface PageArchive {
  title: string;
  /** Full readable text (Readability), falling back to the body text. */
  text: string;
  /** Absolute image URLs, deduped and capped. og/twitter image first. */
  images: string[];
  /** Absolute direct-video URLs (best-effort; excludes blob:/HLS streams). */
  videos: string[];
}

const absUrl = (href: string | null | undefined, base: string): string | null => {
  if (!href) return null;
  const v = href.trim();
  if (!v || v.startsWith('data:') || v.startsWith('blob:')) return null;
  try {
    const u = new URL(v, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

/** Largest candidate from a srcset ("url 320w, url2 640w" / "url 1x, url2 2x"). */
const largestFromSrcset = (srcset: string, base: string): string | null => {
  let best: string | null = null;
  let bestScore = -1;
  for (const part of srcset.split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    const score = size ? parseFloat(size) || 0 : 0;
    const abs = absUrl(url, base);
    if (abs && score >= bestScore) {
      best = abs;
      bestScore = score;
    }
  }
  return best;
};

// linkedom types query results loosely (unknown); a minimal element shape lets
// us read the attributes/children we need without pulling in a full DOM lib.
interface El {
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): Iterable<El>;
  textContent: string | null;
}

const isTrackingPixel = (el: El): boolean => {
  const w = Number(el.getAttribute('width'));
  const h = Number(el.getAttribute('height'));
  return (w > 0 && w <= 2) || (h > 0 && h <= 2);
};

const MAX_IMAGES = 24;
const MAX_VIDEOS = 8;

export function extractArchive(html: string, baseUrl: string): PageArchive {
  const { document } = parseHTML(html);

  const meta = (selector: string): string | null =>
    document.querySelector(selector)?.getAttribute('content') ?? null;

  const images: string[] = [];
  const seenImg = new Set<string>();
  const pushImg = (url: string | null) => {
    if (url && !seenImg.has(url) && images.length < MAX_IMAGES) {
      seenImg.add(url);
      images.push(url);
    }
  };

  // og/twitter image(s) first — usually the post's primary media.
  pushImg(absUrl(meta('meta[property="og:image"]'), baseUrl));
  pushImg(absUrl(meta('meta[property="og:image:secure_url"]'), baseUrl));
  pushImg(absUrl(meta('meta[name="twitter:image"]'), baseUrl));

  for (const img of Array.from(
    document.querySelectorAll('img') as Iterable<El>
  )) {
    if (isTrackingPixel(img)) continue;
    const srcset = img.getAttribute('srcset');
    pushImg(
      absUrl(
        img.getAttribute('src') ??
          img.getAttribute('data-src') ??
          img.getAttribute('data-delayed-url'),
        baseUrl
      ) ?? (srcset ? largestFromSrcset(srcset, baseUrl) : null)
    );
  }

  const videos: string[] = [];
  const seenVid = new Set<string>();
  const pushVid = (url: string | null) => {
    if (url && !seenVid.has(url) && videos.length < MAX_VIDEOS) {
      seenVid.add(url);
      videos.push(url);
    }
  };
  pushVid(
    absUrl(
      meta('meta[property="og:video:secure_url"]') ??
        meta('meta[property="og:video:url"]') ??
        meta('meta[property="og:video"]'),
      baseUrl
    )
  );
  pushVid(absUrl(meta('meta[name="twitter:player:stream"]'), baseUrl));
  for (const v of Array.from(
    document.querySelectorAll('video') as Iterable<El>
  )) {
    pushVid(absUrl(v.getAttribute('src'), baseUrl));
    for (const s of Array.from(v.querySelectorAll('source') as Iterable<El>)) {
      pushVid(absUrl(s.getAttribute('src'), baseUrl));
    }
  }

  let title = (meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    document.querySelector('title')?.textContent ??
    '')!.replace(/\s+/g, ' ').trim();

  let text = '';
  try {
    const article = new Readability(
      document as unknown as Document
    ).parse() as { title?: string; textContent?: string } | null;
    text = (article?.textContent ?? '').trim();
    if (!title && article?.title) title = article.title.trim();
  } catch {
    /* fall through to body text */
  }
  if (text.length < 200) {
    const body = document.querySelector('body')?.textContent ?? '';
    const bodyText = body.replace(/\s+/g, ' ').trim();
    if (bodyText.length > text.length) text = bodyText;
  }

  return { title, text, images, videos };
}

/** Hostnames whose posts are link-rot-prone → offer to archive on clip. */
const ARCHIVE_HOSTS = [
  'linkedin.com',
  'lnkd.in',
  'facebook.com',
  'fb.com',
  'fb.watch',
];

export function isArchivableSocialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return ARCHIVE_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}
