import { UA } from './constants';

/**
 * Best-effort check of whether a URL can be shown in an iframe: false when the
 * site sends `X-Frame-Options: DENY/SAMEORIGIN` or a restrictive CSP
 * `frame-ancestors`. Network is injected so each host controls its policy.
 * (Cannot detect mixed-content blocking — that's the browser's call at render.)
 */
export async function isEmbeddable(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    if (!/^https?:\/\//i.test(url)) return false;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { 'user-agent': UA },
      redirect: 'follow',
    });

    const xfo = (res.headers.get('x-frame-options') ?? '').toLowerCase();
    if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;

    const csp = (
      res.headers.get('content-security-policy') ?? ''
    ).toLowerCase();
    const match = csp.match(/frame-ancestors([^;]*)/);
    if (match) {
      const value = match[1].trim();
      // Only treat as embeddable if it explicitly allows any origin.
      if (!value.includes('*')) return false;
    }
    return true;
  } catch {
    // Network/SSRF failure — assume embeddable and let the iframe try.
    return true;
  }
}
