/**
 * @vitest-environment happy-dom
 */
import { UserFriendlyError } from '@notesgraph/error';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { handleSessionError } from './session';

const versionError = () =>
  new UserFriendlyError({
    status: 400,
    code: 'UNSUPPORTED_CLIENT_VERSION',
    type: 'ACTION_FORBIDDEN',
    name: 'UNSUPPORTED_CLIENT_VERSION',
    message: 'Client version is not supported.',
  } as any);

const otherError = () =>
  new UserFriendlyError({
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    type: 'INTERNAL_SERVER_ERROR',
    name: 'INTERNAL_SERVER_ERROR',
    message: 'boom',
  } as any);

describe('handleSessionError (logout-on-deploy fix)', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(globalThis.location, 'reload', {
      configurable: true,
      value: reload,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('always re-throws — never converts an error into a sign-out', () => {
    const err = versionError();
    expect(() => handleSessionError(err)).toThrow(err);
    const other = otherError();
    expect(() => handleSessionError(other)).toThrow(other);
  });

  test('a client-version mismatch reloads once to fetch the new bundle', () => {
    expect(() => handleSessionError(versionError())).toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('does not reload again on a second version error in the same tab', () => {
    expect(() => handleSessionError(versionError())).toThrow();
    expect(() => handleSessionError(versionError())).toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a non-version error never reloads', () => {
    expect(() => handleSessionError(otherError())).toThrow();
    expect(reload).not.toHaveBeenCalled();
  });
});
