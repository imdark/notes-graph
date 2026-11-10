import { createReadStream } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import http from 'node:http';

import {
  type ClipMode,
  extract,
  fetchFaviconDataUrl,
  fetchYoutubeTranscript,
  isEmbeddable,
  renderCard,
  UA,
  type VideoTranscript,
} from '@notesgraph/link-card';
import { renderScreenshot } from '@notesgraph/link-card/screenshot';
import { ImapFlow } from 'imapflow';

import {
  DEFAULT_MAX_VIDEO_BYTES,
  downloadYoutubeVideo,
  VideoDownloadError,
} from './youtube-video';

const PORT = Number(process.env.PORT ?? 8088);
const BASE_URL = process.env.LINK_CARD_BASE_URL ?? `http://localhost:${PORT}`;
const RESULT_TTL_MS = Number(process.env.CLIP_RESULT_TTL ?? 3600) * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // `x-proxy-authorization` lets token-based crawlers (e.g. Slack) forward an
  // auth header through the proxy without putting the token in the URL.
  // `Authorization` must be allowed because the Android app's patched fetch
  // attaches a Bearer token to every same-server request — without it the
  // preflight fails and mobile link cards show "Failed to retrieve link
  // information".
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-proxy-authorization',
};

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---- background "queue": in-memory cache + in-flight dedup (idempotent by mode+url) ----
interface CacheEntry {
  buffer: Buffer;
  at: number;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Buffer>>();

const transcriptCache = new Map<
  string,
  { transcript: VideoTranscript; at: number }
>();
const transcriptInflight = new Map<string, Promise<VideoTranscript>>();

function keyFor(url: string, mode: ClipMode) {
  return `${mode}\0${url}`;
}

function render(url: string, mode: ClipMode): Promise<Buffer> {
  return mode === 'screenshot'
    ? renderScreenshot(url, { maxWidth: 1280 })
    : renderCard(url);
}

async function getImage(url: string, mode: ClipMode): Promise<Buffer> {
  const key = keyFor(url, mode);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.buffer;

  let pending = inflight.get(key);
  if (!pending) {
    pending = render(url, mode)
      .then(buffer => {
        cache.set(key, { buffer, at: Date.now() });
        return buffer;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

function imageUrl(url: string, mode: ClipMode) {
  return `${BASE_URL}/clip/image?url=${encodeURIComponent(url)}&mode=${mode}`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json;charset=UTF-8',
    ...CORS,
  });
  res.end(JSON.stringify(body));
}

/** Build the link-preview payload NotesGraph expects (images[0] -> bookmark image). */
async function preview(url: string) {
  const meta = await extract(url);
  // Pre-warm the card render so the image is ready when the bookmark loads it.
  void getImage(url, 'card').catch(() => {});
  // Inline the favicon as a data URL so it persists in the doc (synced + stored
  // locally) and renders offline without re-fetching.
  const favicon = isHttpUrl(meta.icon)
    ? ((await fetchFaviconDataUrl(meta.icon)) ?? meta.icon)
    : undefined;
  return {
    url: meta.url,
    title: meta.title,
    siteName: meta.siteName,
    description: meta.excerpt,
    // card first => card by default; keep the og:image as a fallback
    images: [imageUrl(url, 'card'), ...(meta.image ? [meta.image] : [])],
    favicons: favicon ? [favicon] : [],
    mediaType: 'text/html',
  };
}

// ---- news article image resolution (Discover feed) ----
// Aggregator links (e.g. Google News) hide the real article URL. Decode it from
// the Google News link itself; failing that, search Perplexity for the headline
// + source (only when a key is configured). Then read that article's og:image.
// Resolved once and cached here so every client shares the result.
const PERPLEXITY_KEY =
  process.env.PERPLEXITY_API_KEY ?? process.env.COPILOT_PERPLEXITY_API_KEY;
const newsImageCache = new Map<string, { image: string | null; at: number }>();
const newsInflight = new Map<string, Promise<string | null>>();
const NEWS_OK_TTL_MS = 24 * 3600 * 1000; // og:images don't change
const NEWS_MISS_TTL_MS = 10 * 60 * 1000; // retry failures sooner

async function resolveNewsUrl(
  title: string,
  source: string
): Promise<string | null> {
  if (!PERPLEXITY_KEY) return null;
  const res = await fetch('https://api.perplexity.ai/search', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${PERPLEXITY_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: `${title} ${source}`.trim(),
      max_results: 1,
    }),
  });
  if (!res.ok) throw new Error(`perplexity ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ url?: string }> };
  const url = data.results?.[0]?.url;
  return isHttpUrl(url) ? url : null;
}

// Google rate-limits decoding (429 after a few dozen quick requests), so run at
// most GNEWS_CONCURRENCY at once and stop for a while after a 429.
const GNEWS_CONCURRENCY = 2;
const GNEWS_COOLDOWN_MS = 10 * 60 * 1000;
let gnewsActive = 0;
const gnewsQueue: Array<() => void> = [];
let gnewsBlockedUntil = 0;

async function withGnewsSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (gnewsActive >= GNEWS_CONCURRENCY) {
    // the releasing caller hands its slot straight to us
    await new Promise<void>(resolve => gnewsQueue.push(resolve));
  } else {
    gnewsActive++;
  }
  try {
    return await fn();
  } finally {
    const next = gnewsQueue.shift();
    if (next) next();
    else gnewsActive--;
  }
}

function gnewsOk(res: Response): boolean {
  if (res.status === 429) gnewsBlockedUntil = Date.now() + GNEWS_COOLDOWN_MS;
  return res.ok;
}

// Opaque client context the Google News web app sends with "garturlreq".
// prettier-ignore
const GARTURL_CONTEXT = [
  ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
  'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
];

/**
 * The publisher URL behind a news.google.com/rss/articles/<id> link. The id no
 * longer embeds the URL, so do what the Google News page does: read the
 * article's signature + timestamp off its page, then ask batchexecute for the
 * URL. Returns null for non-Google-News links or when Google changes the shape.
 */
async function decodeGoogleNewsUrl(link: string): Promise<string | null> {
  let id: string | undefined;
  try {
    const u = new URL(link);
    if (u.hostname !== 'news.google.com') return null;
    id = u.pathname.match(/\/articles\/([^/?]+)/)?.[1];
  } catch {
    return null;
  }
  if (!id || Date.now() < gnewsBlockedUntil) return null;
  const articleId = id;
  return withGnewsSlot(async () =>
    Date.now() < gnewsBlockedUntil ? null : fetchGoogleNewsUrl(articleId)
  );
}

async function fetchGoogleNewsUrl(id: string): Promise<string | null> {
  const page = await fetch(`https://news.google.com/articles/${id}`, {
    headers: { 'user-agent': UA },
  });
  if (!gnewsOk(page)) return null;
  const html = await page.text();
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) return null;

  const inner = JSON.stringify([
    'garturlreq',
    GARTURL_CONTEXT,
    id,
    Number(ts),
    sig,
  ]);
  const res = await fetch(
    'https://news.google.com/_/DotsSplashUi/data/batchexecute',
    {
      method: 'POST',
      headers: {
        'user-agent': UA,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `f.req=${encodeURIComponent(
        JSON.stringify([[['Fbv4je', inner, null, 'generic']]])
      )}`,
    }
  );
  if (!gnewsOk(res)) return null;
  // Response is `)]}'\n\n<json>`; the payload is a JSON string at [0][2].
  const text = await res.text();
  const body = text.slice(text.indexOf('\n\n') + 2);
  const payload = (JSON.parse(body) as unknown[][])[0]?.[2];
  if (typeof payload !== 'string') return null;
  const url = (JSON.parse(payload) as unknown[])[1];
  return typeof url === 'string' && isHttpUrl(url) ? url : null;
}

async function newsImage(
  title: string,
  source: string,
  link: string
): Promise<string | null> {
  const key = `${title}\0${source}`;
  const hit = newsImageCache.get(key);
  if (
    hit &&
    Date.now() - hit.at < (hit.image ? NEWS_OK_TTL_MS : NEWS_MISS_TTL_MS)
  ) {
    return hit.image;
  }
  let pending = newsInflight.get(key);
  if (!pending) {
    pending = (async () => {
      let image: string | null = null;
      try {
        const url =
          (await decodeGoogleNewsUrl(link).catch(() => null)) ??
          (await resolveNewsUrl(title, source));
        if (url) {
          const meta = await extract(url);
          image = isHttpUrl(meta.image) ? meta.image : null;
        }
      } catch {
        image = null;
      }
      newsImageCache.set(key, { image, at: Date.now() });
      return image;
    })().finally(() => newsInflight.delete(key));
    newsInflight.set(key, pending);
  }
  return pending;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const reqUrl = new URL(req.url ?? '/', BASE_URL);
    const path = reqUrl.pathname;

    if (path === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Error inventory sink for the in-app ErrorReporter. Logs each submission to
    // stdout so it's captured by `docker logs notesgraph_linkcard`, and appends
    // to a JSONL file for later triage.
    if (path === '/clip/log' && req.method === 'POST') {
      const raw = (await readBody(req)) || '{}';
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { raw };
      }
      const line = JSON.stringify({ at: new Date().toISOString(), payload });
      console.log('[NG-ERROR-REPORT]', line);
      try {
        await appendFile(
          process.env.LINK_CARD_LOG ?? '/tmp/ng-errors.jsonl',
          line + '\n'
        );
      } catch {
        // best-effort; stdout capture is the primary sink
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === '/clip/preview') {
      let url: string | null = reqUrl.searchParams.get('url');
      if (req.method === 'POST') {
        const body = await readBody(req);
        url = (body ? (JSON.parse(body) as { url?: string }).url : null) ?? url;
      }
      if (!isHttpUrl(url)) {
        sendJson(res, 400, { error: 'Invalid or missing "url"' });
        return;
      }
      sendJson(res, 200, await preview(url));
      return;
    }

    if (path === '/clip/news-image') {
      const title = reqUrl.searchParams.get('title');
      const source = reqUrl.searchParams.get('source') ?? '';
      const link = reqUrl.searchParams.get('url') ?? '';
      if (!title) {
        sendJson(res, 400, { error: 'missing "title"' });
        return;
      }
      sendJson(res, 200, { image: await newsImage(title, source, link) });
      return;
    }

    if (path === '/clip/image') {
      const url = reqUrl.searchParams.get('url');
      const mode = (reqUrl.searchParams.get('mode') ?? 'card') as ClipMode;
      if (!isHttpUrl(url) || (mode !== 'card' && mode !== 'screenshot')) {
        sendJson(res, 400, { error: 'Invalid "url" or "mode"' });
        return;
      }
      const buffer = await getImage(url, mode);
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=3600',
        ...CORS,
      });
      res.end(buffer);
      return;
    }

    // YouTube transcript: fetched server-side (the caption endpoints send no
    // CORS headers) and cached like renders — transcripts are immutable per
    // video, so the TTL cache mainly dedupes bursts.
    if (path === '/clip/transcript') {
      const url = reqUrl.searchParams.get('url');
      if (!isHttpUrl(url)) {
        sendJson(res, 400, { error: 'Invalid or missing "url"' });
        return;
      }
      const key = `transcript ${url}`;
      const hit = transcriptCache.get(key);
      if (hit && Date.now() - hit.at < RESULT_TTL_MS) {
        sendJson(res, 200, hit.transcript);
        return;
      }
      let pending = transcriptInflight.get(key);
      if (!pending) {
        pending = fetchYoutubeTranscript(url)
          .then(transcript => {
            transcriptCache.set(key, { transcript, at: Date.now() });
            return transcript;
          })
          .finally(() => transcriptInflight.delete(key));
        transcriptInflight.set(key, pending);
      }
      try {
        sendJson(res, 200, await pending);
      } catch (err) {
        sendJson(res, 422, { error: (err as Error).message });
      }
      return;
    }

    // YouTube video backup: yt-dlp downloads the video (<= 720p mp4) and it is
    // streamed back for the app to store as an attachment blob. The title
    // rides in a header so the body stays the raw file.
    if (path === '/clip/video') {
      const url = reqUrl.searchParams.get('url');
      if (!isHttpUrl(url)) {
        sendJson(res, 400, { error: 'Invalid or missing "url"' });
        return;
      }
      const requested = Number(reqUrl.searchParams.get('maxBytes'));
      const maxBytes =
        Number.isFinite(requested) && requested > 0
          ? Math.min(requested, DEFAULT_MAX_VIDEO_BYTES)
          : DEFAULT_MAX_VIDEO_BYTES;
      let video;
      try {
        video = await downloadYoutubeVideo(url, maxBytes);
      } catch (err) {
        const status = err instanceof VideoDownloadError ? err.status : 500;
        sendJson(res, status, { error: (err as Error).message });
        return;
      }
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'content-length': String(video.size),
        'cache-control': 'no-store',
        'x-video-title': encodeURIComponent(video.title),
        'Access-Control-Expose-Headers': 'x-video-title',
        ...CORS,
      });
      const stream = createReadStream(video.path);
      stream.on('close', () => void video.cleanup());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    if (path === '/clip/embeddable') {
      const url = reqUrl.searchParams.get('url');
      if (!isHttpUrl(url)) {
        sendJson(res, 400, { error: 'Invalid "url"' });
        return;
      }
      sendJson(res, 200, { embeddable: await isEmbeddable(url) });
      return;
    }

    // Generic image proxy (replaces NotesGraph's /api/worker/image-proxy locally),
    // so og:images / favicons / card images all load without the backend.
    if (path === '/clip/image-proxy') {
      const target = reqUrl.searchParams.get('url');
      if (!isHttpUrl(target)) {
        sendJson(res, 400, { error: 'Invalid "url"' });
        return;
      }
      const upstream = await fetch(target, { headers: { 'user-agent': UA } });
      if (!upstream.ok) {
        res.writeHead(upstream.status, CORS);
        res.end();
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, {
        'content-type':
          upstream.headers.get('content-type') ?? 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
        ...CORS,
      });
      res.end(buffer);
      return;
    }

    // Raw text proxy for crawlers (RSS / Atom / JSON feeds). Fetches
    // server-side so the frontend can read cross-origin feeds — e.g. a
    // YouTube channel's RSS — that send no CORS headers.
    if (path === '/clip/fetch') {
      const target = reqUrl.searchParams.get('url');
      if (!isHttpUrl(target)) {
        sendJson(res, 400, { error: 'Invalid "url"' });
        return;
      }
      const headers: Record<string, string> = { 'user-agent': UA };
      const forwardedAuth = req.headers['x-proxy-authorization'];
      if (typeof forwardedAuth === 'string' && forwardedAuth) {
        headers.authorization = forwardedAuth;
      }
      // Forward POST + body (e.g. an OAuth token-exchange for Gmail).
      const method = req.method === 'POST' ? 'POST' : 'GET';
      let body: string | undefined;
      if (method === 'POST') {
        body = await readBody(req);
        const contentType = req.headers['content-type'];
        if (typeof contentType === 'string') {
          headers['content-type'] = contentType;
        }
      }
      const upstream = await fetch(target, { method, headers, body });
      const text = await upstream.text();
      res.writeHead(upstream.ok ? 200 : upstream.status, {
        'content-type':
          upstream.headers.get('content-type') ?? 'text/plain;charset=UTF-8',
        'cache-control': 'no-store',
        ...CORS,
      });
      res.end(text);
      return;
    }

    // IMAP mailbox reader for the email crawler. Connects with the supplied
    // credentials (an app password) and returns recent message envelopes.
    if (path === '/clip/imap' && req.method === 'POST') {
      const {
        host,
        port,
        secure,
        user,
        pass,
        mailbox = 'INBOX',
        limit = 30,
      } = JSON.parse((await readBody(req)) || '{}') as {
        host?: string;
        port?: number;
        secure?: boolean;
        user?: string;
        pass?: string;
        mailbox?: string;
        limit?: number;
      };
      if (!host || !user || !pass) {
        sendJson(res, 400, { error: 'Missing host / user / pass' });
        return;
      }
      const client = new ImapFlow({
        host,
        port: port ?? 993,
        secure: secure ?? true,
        auth: { user, pass },
        logger: false,
      });
      const messages: Array<{
        uid: number;
        from: string;
        fromName: string;
        subject: string;
        date: number | null;
      }> = [];
      try {
        await client.connect();
        const lock = await client.getMailboxLock(mailbox);
        try {
          const total =
            typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
          if (total > 0) {
            const start = Math.max(1, total - limit + 1);
            for await (const msg of client.fetch(`${start}:*`, {
              envelope: true,
              uid: true,
              internalDate: true,
            })) {
              const sender = msg.envelope?.from?.[0];
              // envelope.date may be a string or Date depending on the server;
              // normalize through the Date constructor.
              const rawDate = msg.envelope?.date ?? msg.internalDate;
              messages.push({
                uid: msg.uid,
                from: sender?.address ?? '',
                fromName: sender?.name ?? '',
                subject: msg.envelope?.subject ?? '(no subject)',
                date: rawDate ? new Date(rawDate).getTime() : null,
              });
            }
          }
        } finally {
          lock.release();
        }
        await client.logout();
      } catch (err) {
        try {
          client.close();
        } catch {
          // already closed
        }
        sendJson(res, 502, { error: (err as Error).message });
        return;
      }
      sendJson(res, 200, { messages: messages.reverse() });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: (err as Error).message });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    try {
      res.writeHead(500, CORS);
      res.end();
    } catch {
      // response already sent
    }
  });
});

server.listen(PORT, () => {
  console.log(`link-card-server listening on ${BASE_URL}`);
});
