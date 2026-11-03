import { describe, expect, test } from 'vitest';

import { whoami } from './identity';

const fetchWith =
  (reply: unknown, status = 200) =>
  async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init);
    return {
      ok: status < 300,
      status,
      json: async () => reply,
    } as unknown as Response;
  };
let calls: (RequestInit | undefined)[] = [];

describe('whoami', () => {
  test('forwards the cookie and reads the user and admin flag', async () => {
    calls = [];
    const user = await whoami(
      { headers: { cookie: 'sid=abc' } },
      {
        appUrl: 'http://app/',
        fetchImpl: fetchWith({
          data: {
            currentUser: {
              id: 'u1',
              name: 'Ann',
              email: 'a@x',
              features: ['Admin'],
            },
          },
        }),
      }
    );
    expect(user).toEqual({ id: 'u1', name: 'Ann', email: 'a@x', admin: true });
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers.cookie).toBe('sid=abc');
    expect(headers.authorization).toBeUndefined();
  });

  test('a request with no credentials never asks the app', async () => {
    calls = [];
    const user = await whoami(
      { headers: {} },
      { appUrl: 'http://app', fetchImpl: fetchWith({}) }
    );
    expect(user).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a signed-out session, an app error, or a network failure is nobody', async () => {
    expect(
      await whoami(
        { headers: { authorization: 'Bearer t' } },
        {
          appUrl: 'http://app',
          fetchImpl: fetchWith({ data: { currentUser: null } }),
        }
      )
    ).toBeNull();
    expect(
      await whoami(
        { headers: { authorization: 'Bearer t' } },
        { appUrl: 'http://app', fetchImpl: fetchWith({}, 500) }
      )
    ).toBeNull();
    expect(
      await whoami(
        { headers: { authorization: 'Bearer t' } },
        {
          appUrl: 'http://app',
          fetchImpl: async () => {
            throw new Error('down');
          },
        }
      )
    ).toBeNull();
  });

  test('a non-admin is not an admin', async () => {
    const user = await whoami(
      { headers: { cookie: 'x' } },
      {
        appUrl: 'http://app',
        fetchImpl: fetchWith({
          data: {
            currentUser: {
              id: 'u2',
              name: 'B',
              email: 'b@x',
              features: ['ProPlan'],
            },
          },
        }),
      }
    );
    expect(user?.admin).toBe(false);
  });
});
