/**
 * The marketplace API, same-origin. On prod the sidecar sits behind
 * `/market/*` (prefix stripped before it reaches the sidecar); locally it is
 * served from `/`. The base is whatever precedes `/site/` in this page's
 * path, or the path without its trailing slash: `/market` there, `` here.
 */
export const API_BASE = (() => {
  const path = location.pathname;
  const site = path.indexOf('/site/');
  const base = site >= 0 ? path.slice(0, site) : path.replace(/\/[^/]*$/, '');
  return base.replace(/\/+$/, '');
})();

/** Where to send someone to sign in: the app itself, on this origin. */
export const APP_URL = `${location.origin}/`;

export class ApiError extends Error {
  constructor(status, body) {
    super(
      (body && typeof body.error === 'string' && body.error) ||
        `request failed (${status})`
    );
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  me: () => request('GET', '/me'),
  plugins: q =>
    request('GET', `/plugins${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  plugin: id => request('GET', `/plugins/${encodeURIComponent(id)}`),
  pubkey: () => request('GET', '/pubkey'),
  registerDeveloper: (name, publicKey) =>
    request('POST', '/developers', { name, publicKey }),
  myPlugins: () => request('GET', '/me/plugins'),
  publish: body => request('POST', '/publish', body),
  pending: () => request('GET', '/admin/pending'),
  approve: (id, version) =>
    request(
      'POST',
      `/admin/${encodeURIComponent(id)}/${encodeURIComponent(version)}/approve`
    ),
  reject: (id, version, reason) =>
    request(
      'POST',
      `/admin/${encodeURIComponent(id)}/${encodeURIComponent(version)}/reject`,
      { reason }
    ),
  downloadUrl: (id, version, file) =>
    `${API_BASE}/download/${encodeURIComponent(id)}/${encodeURIComponent(version)}/${file}`,
};
