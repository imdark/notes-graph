/**
 * Who is calling. The proxy in front (Caddy, see scripts/prod/market-sidecar.md)
 * only proves that a write carries *a* valid session; this asks the app which
 * user it is, forwarding the request's own Cookie / Authorization, and whether
 * they are an admin (the `Admin` feature on their account).
 */
import http from 'node:http';

export interface CallerUser {
  id: string;
  name: string;
  email: string;
  admin: boolean;
}

export interface IdentityOptions {
  /** The app's own URL, reachable from here: http://notesgraph:3010 in compose. */
  appUrl: string;
  fetchImpl?: typeof fetch;
  /** How long to wait for the app (ms). */
  timeoutMs?: number;
}

const QUERY = `query MarketCaller { currentUser { id name email features } }`;

/** The caller's identity, or null when the request carries no valid session. */
export async function whoami(
  req: Pick<http.IncomingMessage, 'headers'>,
  options: IdentityOptions
): Promise<CallerUser | null> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // The app's version guard, when on, wants to know what client is asking.
    'x-notesgraph-version': process.env.NOTESGRAPH_VERSION ?? '0.26.3',
  };
  const cookie = req.headers.cookie;
  const auth = req.headers.authorization;
  if (!cookie && !auth) return null;
  if (cookie)
    headers.cookie = Array.isArray(cookie) ? cookie.join('; ') : cookie;
  if (auth) headers.authorization = Array.isArray(auth) ? auth[0] : auth;

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const res = await fetchImpl(
      `${options.appUrl.replace(/\/$/, '')}/graphql`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: QUERY }),
        signal: controller.signal,
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: {
        currentUser?: {
          id: string;
          name: string;
          email: string;
          features?: string[];
        } | null;
      };
    };
    const user = data.data?.currentUser;
    if (!user?.id) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      admin: (user.features ?? []).includes('Admin'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
