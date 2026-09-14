import {
  deleteAccountMutation,
  removeAvatarMutation,
  ServerDeploymentType,
  updateUserProfileMutation,
  uploadAvatarMutation,
} from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';
import type { CurrentUserProfileSnapshot } from '@notesgraph/realtime';

import type { GlobalState, NbstoreService } from '../../storage';
import type { AuthSessionInfo } from '../entities/session';
import type { AuthProvider, SignInUserInfo } from '../provider/auth';
import type { FetchService } from '../services/fetch';
import type { GraphQLService } from '../services/graphql';
import type { ServerService } from '../services/server';

export interface AccountProfile extends CurrentUserProfileSnapshot {
  authMethods?: {
    password: { bound: boolean };
    oauth: { bound: boolean; providers: string[] };
    passkey: { bound: boolean; count: number };
  };
}

export class AuthStore extends Store {
  constructor(
    private readonly fetchService: FetchService,
    private readonly gqlService: GraphQLService,
    private readonly globalState: GlobalState,
    private readonly serverService: ServerService,
    private readonly authProvider: AuthProvider,
    private readonly nbstoreService: NbstoreService
  ) {
    super();
  }

  watchCachedAuthSession() {
    return this.globalState.watch<AuthSessionInfo>(
      `${this.serverService.server.id}-auth`
    );
  }

  getCachedAuthSession() {
    return this.globalState.get<AuthSessionInfo>(
      `${this.serverService.server.id}-auth`
    );
  }

  setCachedAuthSession(session: AuthSessionInfo | null) {
    this.globalState.set(`${this.serverService.server.id}-auth`, session);
  }

  setCachedSignInUser(user: SignInUserInfo) {
    this.setCachedAuthSession({
      account: {
        id: user.id,
        email: user.email,
        label: user.name,
        avatar: user.avatarUrl,
        info: {
          id: user.id,
          email: user.email,
          name: user.name,
          hasPassword: user.hasPassword,
          avatarUrl: user.avatarUrl,
          emailVerified: user.emailVerified,
          features: [],
        },
      },
    });
  }

  getClientNonce() {
    return this.globalState.get<string>('auth-client-nonce');
  }

  setClientNonce(nonce: string) {
    this.globalState.set('auth-client-nonce', nonce);
  }

  async fetchSession() {
    const session = await this.fetchAuthSession();
    if (!session.user) return { user: null };

    const { user } = await this.nbstoreService.realtime.request(
      'user.profile.get',
      {}
    );
    if (!user || user.id !== session.user.id) {
      throw new Error('Realtime user profile does not match auth session');
    }
    const authMethods = await this.fetchAuthMethods();
    return { user: { ...user, authMethods } };
  }

  private async fetchAuthSession(): Promise<{ user: { id: string } | null }> {
    const res = await this.fetchService.fetch('/api/auth/session', {
      cache: 'no-store',
    });
    if (res.ok) {
      return await res.json();
    }
    // A genuine auth rejection (session revoked/expired) means signed out.
    // Anything else — a 5xx, an offline/flaky response that resolves instead
    // of rejecting, a captive-portal or proxy page, the server mid-deploy —
    // is transient and must NOT be read as "logged out": throw so session
    // revalidation retries and keeps the cached session. Previously this did
    // `res.json()` unconditionally, so any non-200 whose body lacked a `user`
    // silently signed the user out — the random-logout-while-offline bug.
    if (res.status === 401 || res.status === 403) {
      return { user: null };
    }
    throw new Error(`auth session request failed with status ${res.status}`);
  }

  private async fetchAuthMethods() {
    return await this.fetchService
      .fetch('/api/auth/methods')
      .then(res => (res.ok ? res.json() : undefined));
  }

  async signInMagicLink(email: string, token: string) {
    await this.authProvider.signInMagicLink(
      email,
      token,
      this.getClientNonce()
    );
  }

  async signInOauth(code: string, state: string, provider: string) {
    return await this.authProvider.signInOauth(
      code,
      state,
      provider,
      this.getClientNonce()
    );
  }

  async signInPassword(credential: {
    email: string;
    password: string;
    verifyToken?: string;
    challenge?: string;
  }) {
    return await this.authProvider.signInPassword(credential);
  }

  async signInOpenAppSignInCode(code: string) {
    await this.authProvider.signInOpenAppSignInCode(code);
  }

  async signOut() {
    await this.authProvider.signOut();
    await this.nbstoreService.realtime.configure({
      endpoint: this.serverService.server.baseUrl,
      authenticated: false,
      isSelfHosted:
        this.serverService.server.config$.value.type ===
        ServerDeploymentType.Selfhosted,
    });
  }

  async uploadAvatar(file: File) {
    await this.gqlService.gql({
      query: uploadAvatarMutation,
      variables: {
        avatar: file,
      },
    });
  }

  async removeAvatar() {
    await this.gqlService.gql({
      query: removeAvatarMutation,
    });
  }

  async updateLabel(label: string) {
    await this.gqlService.gql({
      query: updateUserProfileMutation,
      variables: {
        input: {
          name: label,
        },
      },
    });
  }

  async checkUserByEmail(email: string) {
    const res = await this.fetchService.fetch('/api/auth/preflight', {
      method: 'POST',
      body: JSON.stringify({ email }),
      headers: {
        'content-type': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to check user by email: ${email}`);
    }

    const data = (await res.json()) as {
      registered: boolean;
      methods: {
        password: { available: boolean };
        magicLink: { available: boolean };
        oauth: { available: boolean; providers: string[] };
        passkey: { available: boolean; discoverable: boolean };
      };
    };

    return data;
  }

  async deleteAccount() {
    const res = await this.gqlService.gql({
      query: deleteAccountMutation,
    });
    return res.deleteAccount;
  }
}
