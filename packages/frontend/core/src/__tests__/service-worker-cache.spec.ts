import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, test } from 'vitest';

/**
 * Runs public/sw.js with a fake cache and network, and answers one request
 * through its fetch handler.
 */
function serviceWorker(cached: Record<string, string>, network: 'up' | 'down') {
  const origin = 'https://app.test';
  const store = new Map(
    Object.entries(cached).map(([path, body]) => [origin + path, body])
  );
  const fetched: { url: string; cache?: string }[] = [];
  const listeners: Record<string, (event: any) => void> = {};
  const cache = {
    put: async (request: any, response: Response) => {
      store.set(request.url ?? String(request), await response.text());
    },
    keys: async () => [],
    delete: async () => true,
  };
  const context = vm.createContext({
    URL,
    Response,
    self: {
      location: { origin },
      addEventListener: (name: string, fn: (event: any) => void) => {
        listeners[name] = fn;
      },
    },
    caches: {
      open: async () => cache,
      match: async (request: any) => {
        const body = store.get(request.url);
        return body === undefined ? undefined : new Response(body);
      },
    },
    fetch: async (request: any, init?: { cache?: string }) => {
      fetched.push({ url: request.url, cache: init?.cache });
      if (network === 'down') throw new TypeError('Failed to fetch');
      return new Response('from the server');
    },
  });
  vm.runInContext(
    readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8'),
    context
  );

  return {
    fetched,
    store,
    async get(path: string): Promise<string | null> {
      let answer: Promise<Response> | undefined;
      listeners.fetch({
        request: { method: 'GET', url: origin + path, mode: 'no-cors' },
        respondWith: (response: Promise<Response>) => {
          answer = response;
        },
      });
      if (!answer) return null; // left to the browser
      const response = await answer;
      return response.type === 'error' ? 'error' : await response.text();
    },
  };
}

const WORKER = '/js/nbstore-0.26.3.worker.js';
const HASHED = '/js/index.47570049.js';

describe('service worker caching', () => {
  test('a worker script keeps its name across deploys, so the server is asked', async () => {
    const sw = serviceWorker({ [WORKER]: 'cached in July' }, 'up');

    expect(await sw.get(WORKER)).toBe('from the server');
    // Revalidated with the server, not answered from the HTTP cache.
    expect(sw.fetched).toEqual([
      { url: 'https://app.test' + WORKER, cache: 'no-cache' },
    ]);
    // The offline copy is the new one too.
    await Promise.resolve();
    await new Promise(done => setTimeout(done, 0));
    expect(sw.store.get('https://app.test' + WORKER)).toBe('from the server');
  });

  test('offline, the cached worker script is used', async () => {
    const sw = serviceWorker({ [WORKER]: 'cached copy' }, 'down');
    expect(await sw.get(WORKER)).toBe('cached copy');
  });

  test('offline with nothing cached, the request fails', async () => {
    const sw = serviceWorker({}, 'down');
    expect(await sw.get(WORKER)).toBe('error');
  });

  test('a content-hashed script is served from the cache without a request', async () => {
    const sw = serviceWorker({ [HASHED]: 'cached bundle' }, 'up');
    expect(await sw.get(HASHED)).toBe('cached bundle');
    expect(sw.fetched).toEqual([]);
  });

  test('the plugin market is still left to the browser', async () => {
    const sw = serviceWorker({}, 'up');
    expect(await sw.get('/market/app.js')).toBeNull();
  });
});
