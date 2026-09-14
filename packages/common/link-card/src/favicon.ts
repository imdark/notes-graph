import { UA } from './constants';

/**
 * Download a favicon and return it as a `data:` URL, so it can be stored inline
 * in the doc (persisted in the local DB and synced) and rendered offline with
 * no network. Normalizes to a small PNG when sharp can decode the image;
 * otherwise embeds the raw bytes (e.g. `.ico`, which sharp can't rasterize).
 * Network is injected so the host controls its own fetch policy.
 */
export async function fetchFaviconDataUrl(
  iconUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12000
): Promise<string | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(iconUrl, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return undefined;

    try {
      // native module — loaded lazily so importing this file (e.g. bundled
      // into the Electron main process) doesn't require sharp at startup.
      const { default: sharp } = await import('sharp');
      const png = await sharp(buf)
        .resize(64, 64, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      const mime =
        (res.headers.get('content-type') ?? '').split(';')[0] || 'image/x-icon';
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
