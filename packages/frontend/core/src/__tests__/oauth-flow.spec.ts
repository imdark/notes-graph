import {
  attachOAuthFlowToAuthUrl,
  parseOAuthCallbackState,
  resolveOAuthFlowMode,
  resolveOAuthRedirect,
} from '@notesgraph/core/desktop/pages/auth/oauth-flow';
import { describe, expect, test } from 'vitest';

describe('oauth flow mode', () => {
  test('defaults to redirect for missing or unknown values', () => {
    expect(resolveOAuthFlowMode()).toBe('redirect');
    expect(resolveOAuthFlowMode(null)).toBe('redirect');
    expect(resolveOAuthFlowMode('unknown')).toBe('redirect');
  });

  test('persists flow in oauth state instead of web storage', () => {
    const url = attachOAuthFlowToAuthUrl(
      'https://example.com/auth?state=%7B%22state%22%3A%22nonce%22%2C%22provider%22%3A%22Google%22%2C%22client%22%3A%22web%22%7D',
      'redirect'
    );

    expect(
      parseOAuthCallbackState(new URL(url).searchParams.get('state')!)
    ).toEqual({
      client: 'web',
      flow: 'redirect',
      provider: 'Google',
      state: 'nonce',
    });
  });

  test('falls back to popup when callback state has no flow', () => {
    expect(
      parseOAuthCallbackState(
        JSON.stringify({ client: 'web', provider: 'Google', state: 'nonce' })
      ).flow
    ).toBe('popup');
  });

  test('keeps same-origin redirects direct', () => {
    expect(
      resolveOAuthRedirect('/workspace', 'https://app.notesgraph.com')
    ).toBe('/workspace');

    expect(
      resolveOAuthRedirect(
        'https://app.notesgraph.com/workspace?from=oauth',
        'https://app.notesgraph.com'
      )
    ).toBe('https://app.notesgraph.com/workspace?from=oauth');
  });

  test('wraps external redirects with redirect-proxy', () => {
    expect(
      resolveOAuthRedirect(
        'https://github.com/notesgraph/notesgraph',
        'https://app.notesgraph.com'
      )
    ).toBe(
      'https://app.notesgraph.com/redirect-proxy?redirect_uri=https%3A%2F%2Fgithub.com%2Ftoeverything%2FNotesGraph'
    );
  });
});
