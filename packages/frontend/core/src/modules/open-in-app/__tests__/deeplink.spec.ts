import { expect, test } from 'vitest';

import {
  buildAuthenticationDeepLink,
  buildOpenAppUrlRoute,
  normalizeOpenAppSignInNextParam,
} from '../utils';

test('buildAuthenticationDeepLink', () => {
  const payload = { code: '1', next: '/workspace/123' };
  const url = buildAuthenticationDeepLink({
    scheme: 'notesgraph',
    method: 'open-app-signin',
    payload,
    server: 'https://app.notesgraph.local',
  });

  const parsed = new URL(url);

  expect(parsed.protocol).toBe('notesgraph:');
  expect(parsed.hostname).toBe('authentication');
  expect(parsed.searchParams.get('method')).toBe('open-app-signin');
  expect(parsed.searchParams.get('payload')).toBe(JSON.stringify(payload));
  expect(parsed.searchParams.get('server')).toBe(
    'https://app.notesgraph.local'
  );
});

test('buildOpenAppUrlRoute', () => {
  const urlToOpen = 'notesgraph://authentication?method=oauth&payload=%7B%7D';
  const route = buildOpenAppUrlRoute(urlToOpen);

  const parsed = new URL(route, 'https://app.notesgraph.local');
  expect(parsed.pathname).toBe('/open-app/url');
  expect(parsed.searchParams.get('url')).toBe(urlToOpen);
});

test('normalizeOpenAppSignInNextParam', () => {
  expect(
    normalizeOpenAppSignInNextParam(
      '/workspace/123',
      'https://app.notesgraph.local'
    )
  ).toBe('/workspace/123');

  expect(
    normalizeOpenAppSignInNextParam(
      'https://app.notesgraph.local/workspace/123?foo=1#bar',
      'https://app.notesgraph.local'
    )
  ).toBe('/workspace/123?foo=1#bar');

  expect(
    normalizeOpenAppSignInNextParam(
      'https://evil.example/workspace/123',
      'https://app.notesgraph.local'
    )
  ).toBeUndefined();

  expect(
    normalizeOpenAppSignInNextParam(
      '//evil.example/workspace/123',
      'https://app.notesgraph.local'
    )
  ).toBeUndefined();

  expect(
    normalizeOpenAppSignInNextParam(
      '/redirect-proxy?redirect_uri=https://evil.example',
      'https://app.notesgraph.local'
    )
  ).toBeUndefined();
});
