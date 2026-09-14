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
// works.
let endpointTokenReader: (endpoint: string) => Promise<string | null> =
  readEndpointToken;
export function setEndpointTokenReader(
  reader: (endpoint: string) => Promise<string | null>
) {
  endpointTokenReader = reader;
}

const rawFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);

  const origin = authEndpointForUrl(request.url);

  const token = origin
    ? await endpointTokenReader(origin).catch(() => null)
    : null;
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }

  return rawFetch(request);
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
