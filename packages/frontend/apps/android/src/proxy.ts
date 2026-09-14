import { Auth } from './plugins/auth';

function authEndpointForUrl(url: string | URL) {
  try {
    const parsed = new URL(url, globalThis.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function canonicalEndpoint(endpoint: string) {
  return authEndpointForUrl(endpoint) ?? endpoint;
}

/**
 * the below code includes the custom fetch and xmlhttprequest implementation for ios webview.
 * should be included in the entry file of the app or webworker.
 */

// The Capacitor Auth plugin only exists on the main thread. Workers must
// override this with a bridge back to the page (see nbstore.worker.ts),
// otherwise their HTTP requests go out unauthenticated while socket auth
// works — which is exactly how cloud search silently broke on Android.
let endpointTokenReader: (endpoint: string) => Promise<string | null> =
  readEndpointToken;
export function setEndpointTokenReader(
  reader: (endpoint: string) => Promise<string | null>
) {
  endpointTokenReader = reader;
}

// Same story as the reader, for the write side: a worker calling
// writeEndpointToken() directly hits the (main-thread-only) Capacitor plugin
// and silently fails, so a worker-originated 401 refresh (nbstore realtime/
// indexer requests) could never persist its new token — leaving the worker
// stuck retrying with the stale one. Workers must override this with a bridge
// back to the page (see nbstore.worker.ts).
let endpointTokenWriter: (
  endpoint: string,
  token: string
) => Promise<void> = writeEndpointToken;
export function setEndpointTokenWriter(
  writer: (endpoint: string, token: string) => Promise<void>
) {
  endpointTokenWriter = writer;
}

// The native JWT is short-lived (15 min, see jwt-session.ts). Rather than
// tracking expiry client-side, react to the server's own 401 and silently
// swap in a fresh token via /api/auth/native/refresh, then retry once — so
// an idle gap (backgrounded app, screen off) doesn't force a full re-login.
// Concurrent 401s for the same endpoint coalesce onto one refresh call.
const inFlightRefreshes = new Map<string, Promise<string | null>>();

async function refreshEndpointToken(
  origin: string,
  expiredToken: string
): Promise<string | null> {
  const existing = inFlightRefreshes.get(origin);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // This bypasses FetchService (the app's normal request helper), which
      // is what usually attaches x-notesgraph-version — without it the
      // server's version guard rejects the request outright (missing
      // version = UnsupportedClientVersion) and this refresh silently
      // no-ops, leaving the original 401 to propagate as if nothing had
      // been attempted.
      const res = await rawFetch(`${origin}/api/auth/native/refresh`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${expiredToken}`,
          'x-notesgraph-version': BUILD_CONFIG.appVersion,
        },
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const token =
        data &&
        typeof data === 'object' &&
        'token' in data &&
        typeof data.token === 'string'
          ? data.token
          : null;
      if (!token) return null;
      await endpointTokenWriter(origin, token);
      return token;
    } catch {
      return null;
    } finally {
      inFlightRefreshes.delete(origin);
    }
  })();

  inFlightRefreshes.set(origin, promise);
  return promise;
}

const rawFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);

  const origin = authEndpointForUrl(request.url);
  const isRefreshCall =
    !!origin && request.url === `${origin}/api/auth/native/refresh`;

  const token =
    origin && !isRefreshCall
      ? await endpointTokenReader(origin).catch(() => null)
      : null;
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }

  // A body stream can only be read once — clone before the first send so a
  // retry-after-refresh has an untouched request to work with.
  const retryRequest = token ? request.clone() : null;

  const response = await rawFetch(request);

  if (response.status === 401 && origin && token && retryRequest) {
    const newToken = await refreshEndpointToken(origin, token);
    if (newToken) {
      retryRequest.headers.set('Authorization', `Bearer ${newToken}`);
      return rawFetch(retryRequest);
    }
  }

  return response;
};

const rawXMLHttpRequest = globalThis.XMLHttpRequest;
const xhrRequestUrls = new WeakMap<XMLHttpRequest, string>();
globalThis.XMLHttpRequest = class extends rawXMLHttpRequest {
  override open(
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null
  ): void {
    xhrRequestUrls.set(this, url.toString());
    return super.open(
      method,
      url,
      async,
      username ?? undefined,
      password ?? undefined
    );
  }

  override send(body?: Document | XMLHttpRequestBodyInit | null): void {
    const requestUrl = xhrRequestUrls.get(this);
    const origin = authEndpointForUrl(requestUrl ?? globalThis.location.href);

    (origin ? endpointTokenReader(origin) : Promise.resolve(null)).then(
      token => {
        if (token) {
          this.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        return super.send(body);
      },
      () => {
        return super.send(body);
      }
    );
  }
};

export async function readEndpointToken(
  endpoint: string
): Promise<string | null> {
  const { token } = await Auth.readEndpointToken({
    endpoint: canonicalEndpoint(endpoint),
  });
  return token ?? null;
}

export async function writeEndpointToken(endpoint: string, token: string) {
  await Auth.writeEndpointToken({
    endpoint: canonicalEndpoint(endpoint),
    token,
  });
}

export async function deleteEndpointToken(endpoint: string) {
  await Auth.deleteEndpointToken({ endpoint: canonicalEndpoint(endpoint) });
}
