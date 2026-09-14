import { UserFriendlyError } from '@notesgraph/error';
import {
  backoffRetry,
  effect,
  Entity,
  exhaustMapWithTrailing,
  fromPromise,
  LiveData,
  onComplete,
  onStart,
} from '@notesgraph/infra';
import { isEqual } from 'lodash-es';
import { tap } from 'rxjs';

import { validateAndReduceImage } from '../../../utils/reduce-image';
import type { AccountProfile, AuthStore } from '../stores/auth';

export interface AuthSessionInfo {
  account: AuthAccountInfo;
}

const CLIENT_VERSION_RELOAD_KEY = 'ng-client-version-reload';

/**
 * A stale client bundle — typically a browser tab still running the pre-deploy
 * JS after the server bumped its required client version — rejects requests
 * with `UNSUPPORTED_CLIENT_VERSION`. That is NOT a sign-out: on web, reload once
 * per tab to fetch the fresh bundle, which self-heals with the session intact.
 * Guarded against reload loops; desktop has its own updater.
 */
function reloadForClientUpdateOnce() {
  if (BUILD_CONFIG.isElectron) return;
  try {
    if (
      typeof sessionStorage === 'undefined' ||
      typeof location === 'undefined'
    ) {
      return;
    }
    if (sessionStorage.getItem(CLIENT_VERSION_RELOAD_KEY)) return;
    sessionStorage.setItem(CLIENT_VERSION_RELOAD_KEY, String(Date.now()));
    location.reload();
  } catch {
    // storage/location may be unavailable — never let this block revalidation
  }
}

function clearClientUpdateReloadFlag() {
  try {
    sessionStorage?.removeItem?.(CLIENT_VERSION_RELOAD_KEY);
  } catch {
    // ignore
  }
}

/**
 * Handle an error from fetching the session. A client-version mismatch (stale
 * bundle after a deploy) must NOT sign the user out — mapping it to a null
 * session was the "logged out on every deploy" bug. Re-throw every error so the
 * `revalidate` backoffRetry keeps the cached session and retries; only reload
 * once on a version mismatch to pick up the new client. A genuine sign-out is
 * represented by the store returning `{ user: null }`, never by a throw.
 */
export function handleSessionError(error: unknown): never {
  if (UserFriendlyError.fromAny(error).is('UNSUPPORTED_CLIENT_VERSION')) {
    reloadForClientUpdateOnce();
  }
  throw error;
}

export interface AuthAccountInfo {
  id: string;
  label: string;
  email?: string;
  info?: AccountProfile | null;
  avatar?: string | null;
}

export interface AuthSessionUnauthenticated {
  status: 'unauthenticated';
}

export interface AuthSessionAuthenticated {
  status: 'authenticated';
  session: AuthSessionInfo;
}

export type AuthSessionStatus = (
  | AuthSessionUnauthenticated
  | AuthSessionAuthenticated
)['status'];

export class AuthSession extends Entity {
  session$: LiveData<AuthSessionUnauthenticated | AuthSessionAuthenticated> =
    LiveData.from(this.store.watchCachedAuthSession(), null).map(session =>
      session
        ? {
            status: 'authenticated',
            session: session as AuthSessionInfo,
          }
        : {
            status: 'unauthenticated',
          }
    );

  status$ = this.session$.map(session => session.status);

  account$ = this.session$.map(session =>
    session.status === 'authenticated' ? session.session.account : null
  );

  waitForAuthenticated = (signal?: AbortSignal) =>
    this.session$.waitFor(
      session => session.status === 'authenticated',
      signal
    ) as Promise<AuthSessionAuthenticated>;

  isRevalidating$ = new LiveData(false);

  constructor(private readonly store: AuthStore) {
    super();
  }

  revalidate = effect(
    exhaustMapWithTrailing(() =>
      fromPromise(() => this.getSession()).pipe(
        backoffRetry({
          count: Infinity,
        }),
        tap(sessionInfo => {
          if (!isEqual(this.store.getCachedAuthSession(), sessionInfo)) {
            this.store.setCachedAuthSession(sessionInfo);
          }
        }),
        onStart(() => {
          this.isRevalidating$.next(true);
        }),
        onComplete(() => {
          this.isRevalidating$.next(false);
        })
      )
    )
  );

  private async getSession(): Promise<AuthSessionInfo | null> {
    try {
      const session = await this.store.fetchSession();

      if (session?.user) {
        // A good response means our client version is accepted again — let a
        // future deploy trigger another one-time reload.
        clearClientUpdateReloadFlag();
        const account = {
          id: session.user.id,
          email: session.user.email,
          label: session.user.name,
          avatar: session.user.avatarUrl,
          info: session.user,
        };
        const result = {
          account,
        };
        return result;
      } else {
        return null;
      }
    } catch (e) {
      handleSessionError(e);
    }
  }

  async waitForRevalidation(signal?: AbortSignal) {
    this.revalidate();
    await this.isRevalidating$.waitFor(
      isRevalidating => !isRevalidating,
      signal
    );
  }

  async removeAvatar() {
    await this.store.removeAvatar();
    await this.waitForRevalidation();
  }

  async uploadAvatar(file: File) {
    const reducedFile = await validateAndReduceImage(file);
    await this.store.uploadAvatar(reducedFile);
    await this.waitForRevalidation();
  }

  async updateLabel(label: string) {
    await this.store.updateLabel(label);
    await this.waitForRevalidation();
  }

  override dispose(): void {
    this.revalidate.unsubscribe();
  }
}
