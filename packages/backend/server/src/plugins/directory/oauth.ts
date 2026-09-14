import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { SessionCache } from '../../base';
import { DirectoryProviderName } from './providers';

export interface DirectoryOAuthState {
  provider: DirectoryProviderName;
  workspaceId: string;
  userId: string;
  redirectUri?: string;
  token?: string;
}

const DIRECTORY_OAUTH_STATE_KEY = 'DIRECTORY_OAUTH_STATE';

@Injectable()
export class DirectoryOAuthService {
  constructor(private readonly cache: SessionCache) {}

  isValidState(stateStr: string) {
    return stateStr.length === 36;
  }

  async saveOAuthState(state: DirectoryOAuthState) {
    const token = randomUUID();
    const payload: DirectoryOAuthState = { ...state, token };
    await this.cache.set(`${DIRECTORY_OAUTH_STATE_KEY}:${token}`, payload, {
      ttl: 3600 * 3 * 1000,
    });
    return token;
  }

  async getOAuthState(token: string) {
    return this.cache.get<DirectoryOAuthState>(
      `${DIRECTORY_OAUTH_STATE_KEY}:${token}`
    );
  }
}
