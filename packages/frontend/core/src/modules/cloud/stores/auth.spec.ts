import { AuthProvider } from '@notesgraph/core/modules/cloud/provider/auth';
import { FetchService } from '@notesgraph/core/modules/cloud/services/fetch';
import { GraphQLService } from '@notesgraph/core/modules/cloud/services/graphql';
import { ServerService } from '@notesgraph/core/modules/cloud/services/server';
import { AuthStore } from '@notesgraph/core/modules/cloud/stores/auth';
import { GlobalState, NbstoreService } from '@notesgraph/core/modules/storage';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test, vi } from 'vitest';

function createStore({
  fetch,
  request,
}: {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  request: (op: string, input: object) => Promise<unknown>;
}) {
  const framework = new Framework();
  framework.service(FetchService, { fetch } as any);
  framework.service(GraphQLService, {} as any);
  framework.impl(GlobalState, {} as any);
  framework.service(ServerService, {
    server: { id: 'test-server' },
  } as any);
  framework.impl(AuthProvider, {} as any);
  framework.service(NbstoreService, {
    realtime: { request },
  } as any);
  framework.store(AuthStore, [
    FetchService,
    GraphQLService,
    GlobalState,
    ServerService,
    AuthProvider,
    NbstoreService,
  ]);
  return framework.provider().get(AuthStore);
}

describe('AuthStore', () => {
  test('loads account profile from realtime after auth session bootstrap', async () => {
    const authMethods = {
      password: { bound: true },
      oauth: { bound: false, providers: [] },
      passkey: { bound: false, count: 0 },
    };
    const fetch = vi.fn(async (input: string) => {
      if (input === '/api/auth/session') {
        return {
          ok: true,
          json: async () => ({ user: { id: 'u1' } }),
        } as Response;
      }
      if (input === '/api/auth/methods') {
        return {
          ok: true,
          json: async () => authMethods,
        } as Response;
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    const request = vi.fn(async () => ({
      user: {
        id: 'u1',
        email: 'u1@notesgraph.com',
        name: 'User',
        emailVerified: true,
        hasPassword: true,
        avatarUrl: null,
        features: ['Admin'],
      },
    }));
    const store = createStore({ fetch, request });

    await expect(store.fetchSession()).resolves.toEqual({
      user: {
        id: 'u1',
        email: 'u1@notesgraph.com',
        name: 'User',
        emailVerified: true,
        hasPassword: true,
        avatarUrl: null,
        features: ['Admin'],
        authMethods,
      },
    });
    expect(request).toHaveBeenCalledWith('user.profile.get', {});
  });

  test('rejects mismatched realtime profile and auth session', async () => {
    const fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ user: { id: 'u1' } }),
      } as Response;
    });
    const request = vi.fn(async () => ({
      user: {
        id: 'u2',
        email: 'u2@notesgraph.com',
        name: 'User',
        emailVerified: true,
        hasPassword: true,
        avatarUrl: null,
        features: [],
      },
    }));
    const store = createStore({ fetch, request });

    await expect(store.fetchSession()).rejects.toThrow(
      'Realtime user profile does not match auth session'
    );
  });

  // Regression: random logout while offline. A transient/non-ok session
  // response must NOT be read as "signed out" — it must throw so revalidation
  // retries and the cached session survives.
  test('throws (keeps session) on a transient 5xx session response', async () => {
    const request = vi.fn();
    const fetch = vi.fn(async (input: string) => {
      if (input === '/api/auth/session') {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    const store = createStore({ fetch, request });

    await expect(store.fetchSession()).rejects.toThrow(/status 503/);
    // must not even reach the realtime profile fetch
    expect(request).not.toHaveBeenCalled();
  });

  test('throws (keeps session) when the request fails outright (offline)', async () => {
    const request = vi.fn();
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const store = createStore({ fetch, request });

    await expect(store.fetchSession()).rejects.toThrow('Failed to fetch');
    expect(request).not.toHaveBeenCalled();
  });

  test('signs out only on a genuine 401 auth rejection', async () => {
    const request = vi.fn();
    const fetch = vi.fn(async (input: string) => {
      if (input === '/api/auth/session') {
        return { ok: false, status: 401, json: async () => ({}) } as Response;
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    const store = createStore({ fetch, request });

    await expect(store.fetchSession()).resolves.toEqual({ user: null });
    expect(request).not.toHaveBeenCalled();
  });
});
