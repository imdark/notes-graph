import { Inject, Injectable, Logger } from '@nestjs/common';

import { Config, DirectoryProviderRequestError, OnEvent } from '../../../base';
import { DirectoryProviderFactory, DirectoryProviderName } from './factory';

export interface DirectoryProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
}

export interface DirectoryAccountProfile {
  providerAccountId: string;
  email?: string;
  domain?: string;
}

export interface DirectoryProviderUser {
  externalId: string;
  primaryEmail: string;
  suspended?: boolean;
  orgUnitPath?: string;
}

export interface DirectoryProviderGroup {
  externalId: string;
  email: string;
  name?: string;
}

export interface DirectoryProviderOrgUnit {
  externalId: string;
  path: string;
  name?: string;
}

export interface DirectoryProviderListUsersParams {
  accessToken: string;
  domain: string;
  orgUnitPath?: string;
}

export interface DirectoryProviderListGroupsParams {
  accessToken: string;
  domain: string;
}

export interface DirectoryProviderListOrgUnitsParams {
  accessToken: string;
}

export interface DirectoryProviderListGroupMembersParams {
  accessToken: string;
  groupKey: string;
}

@Injectable()
export abstract class DirectoryProvider {
  abstract provider: DirectoryProviderName;
  abstract getAuthUrl(state: string, redirectUri: string): string;
  abstract exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<DirectoryProviderTokens>;
  abstract refreshTokens(
    refreshToken: string
  ): Promise<DirectoryProviderTokens>;
  abstract getAccountProfile(
    accessToken: string
  ): Promise<DirectoryAccountProfile>;
  abstract listUsers(
    params: DirectoryProviderListUsersParams
  ): Promise<DirectoryProviderUser[]>;
  abstract listGroups(
    params: DirectoryProviderListGroupsParams
  ): Promise<DirectoryProviderGroup[]>;
  abstract listGroupMembers(
    params: DirectoryProviderListGroupMembersParams
  ): Promise<DirectoryProviderUser[]>;
  abstract listOrgUnits(
    params: DirectoryProviderListOrgUnitsParams
  ): Promise<DirectoryProviderOrgUnit[]>;

  protected readonly logger = new Logger(this.constructor.name);

  @Inject() private readonly factory!: DirectoryProviderFactory;
  @Inject() private readonly NotesGraphConfig!: Config;

  get config() {
    return (this.NotesGraphConfig.directory as Record<string, any>)[
      this.provider
    ];
  }

  get configured() {
    if (!this.config || !this.config.enabled) {
      return false;
    }
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  @OnEvent('config.init')
  onConfigInit() {
    this.setup();
  }

  @OnEvent('config.changed')
  onConfigUpdated(event: Events['config.changed']) {
    if ('directory' in event.updates) {
      this.setup();
    }
  }

  protected setup() {
    if (this.configured) {
      this.factory.register(this);
    } else {
      this.factory.unregister(this);
    }
  }

  protected get requestTimeoutMs() {
    const timeout = (this.config as { requestTimeoutMs?: number } | undefined)
      ?.requestTimeoutMs;
    return typeof timeout === 'number' && timeout > 0 ? timeout : undefined;
  }

  protected withTimeout(signal?: AbortSignal | null) {
    const timeoutMs = this.requestTimeoutMs;
    if (!timeoutMs) return signal;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!signal) return timeoutSignal;

    return AbortSignal.any([signal, timeoutSignal]);
  }

  protected async fetchJson<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, {
      ...init,
      signal: this.withTimeout(init?.signal),
      headers: { ...init?.headers, Accept: 'application/json' },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new DirectoryProviderRequestError({
        status: response.status,
        message: body,
      });
    }
    if (!body) {
      return {} as T;
    }
    return JSON.parse(body) as T;
  }

  protected postFormJson<T>(
    url: string,
    body: string,
    options?: { headers?: Record<string, string> }
  ) {
    return this.fetchJson<T>(url, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options?.headers,
      },
    });
  }
}
