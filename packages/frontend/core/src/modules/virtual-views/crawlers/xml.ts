import { linkCardFetchEndpoint } from '../../link-card';

/** Fetch text through the sidecar proxy (server-side, no CORS). */
export async function proxyFetchText(url: string): Promise<string> {
  const res = await fetch(linkCardFetchEndpoint(url));
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }
  return res.text();
}

/**
 * Fetch JSON through the sidecar proxy, optionally forwarding an auth header
 * (kept out of the URL) for token-based APIs like Slack.
 */
export async function proxyFetchJson<T = unknown>(
  url: string,
  authorization?: string
): Promise<T> {
  const res = await fetch(
    linkCardFetchEndpoint(url),
    authorization
      ? { headers: { 'x-proxy-authorization': authorization } }
      : undefined
  );
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }
  return res.json() as Promise<T>;
}

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Text of the first matching XML tag inside a fragment. */
export function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]) : undefined;
}

/** Value of an attribute on the first matching (possibly self-closing) tag. */
export function tagAttr(
  xml: string,
  tag: string,
  attr: string
): string | undefined {
  const match = xml.match(
    new RegExp(`<${tag}[^>]*\\b${attr}="([^"]*)"[^>]*>`)
  );
  return match ? match[1] : undefined;
}

/** Strip HTML tags and collapse whitespace for a short text snippet. */
export function textSnippet(html: string, max = 300): string {
  return decodeXml(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
