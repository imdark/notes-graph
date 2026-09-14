/**
 * Client for the `/api/uppy-relay` endpoints (see
 * `packages/backend/server/src/core/uppy-relay`). Companion streams
 * remote-source files (Google Drive, Dropbox, ...) server-to-server — it
 * has no way to hand bytes to the browser directly — so a relay token is
 * minted here, handed to `@uppy/xhr-upload` as the transfer destination,
 * and once Companion posts the result, fetched back down as a real Blob.
 */

async function relayFetch(
  serverBaseUrl: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(`${serverBaseUrl}/api/uppy-relay${path}`, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    throw new Error(`uppy-relay request failed: ${res.status}`);
  }
  return res;
}

export async function mintRelayToken(serverBaseUrl: string): Promise<string> {
  const res = await relayFetch(serverBaseUrl, '', { method: 'POST' });
  const { token } = (await res.json()) as { token: string };
  return token;
}

export function relayEndpoint(serverBaseUrl: string, token: string): string {
  return `${serverBaseUrl}/api/uppy-relay/${token}`;
}

export async function fetchRelayResult(
  serverBaseUrl: string,
  token: string
): Promise<Blob> {
  const res = await relayFetch(serverBaseUrl, `/${token}`);
  return res.blob();
}
