import { Injectable } from '@nestjs/common';

import {
  DirectoryAccountProfile,
  DirectoryProvider,
  DirectoryProviderListGroupMembersParams,
  DirectoryProviderListGroupsParams,
  DirectoryProviderListOrgUnitsParams,
  DirectoryProviderListUsersParams,
  DirectoryProviderTokens,
} from './def';
import { DirectoryProviderName } from './factory';

const DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GoogleUserInfo = {
  id: string;
  email?: string;
  hd?: string;
};

type GoogleDirectoryUser = {
  id: string;
  primaryEmail: string;
  suspended?: boolean;
  orgUnitPath?: string;
};

type GoogleDirectoryUsersResponse = {
  users?: GoogleDirectoryUser[];
  nextPageToken?: string;
};

type GoogleDirectoryGroup = {
  id: string;
  email: string;
  name?: string;
};

type GoogleDirectoryGroupsResponse = {
  groups?: GoogleDirectoryGroup[];
  nextPageToken?: string;
};

type GoogleDirectoryMember = {
  id: string;
  email: string;
  status?: string;
  type?: string;
};

type GoogleDirectoryMembersResponse = {
  members?: GoogleDirectoryMember[];
  nextPageToken?: string;
};

type GoogleOrgUnit = {
  orgUnitId: string;
  orgUnitPath: string;
  name?: string;
};

type GoogleOrgUnitsResponse = {
  organizationUnits?: GoogleOrgUnit[];
};

@Injectable()
export class GoogleDirectoryProvider extends DirectoryProvider {
  provider = DirectoryProviderName.Google;

  getAuthUrl(state: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: DIRECTORY_SCOPES.join(' '),
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<DirectoryProviderTokens> {
    const payload = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await this.postFormJson<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      payload.toString()
    );

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      scope: response.scope,
      tokenType: response.token_type,
      expiresAt: response.expires_in
        ? new Date(Date.now() + response.expires_in * 1000)
        : undefined,
    };
  }

  async refreshTokens(
    refreshToken: string
  ): Promise<DirectoryProviderTokens> {
    const payload = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
    });

    const response = await this.postFormJson<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      payload.toString()
    );

    return {
      accessToken: response.access_token,
      refreshToken,
      scope: response.scope,
      tokenType: response.token_type,
      expiresAt: response.expires_in
        ? new Date(Date.now() + response.expires_in * 1000)
        : undefined,
    };
  }

  async getAccountProfile(
    accessToken: string
  ): Promise<DirectoryAccountProfile> {
    const response = await this.fetchJson<GoogleUserInfo>(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return {
      providerAccountId: response.id,
      email: response.email,
      domain: response.hd,
    };
  }

  async listUsers(params: DirectoryProviderListUsersParams) {
    const users: GoogleDirectoryUser[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        'https://admin.googleapis.com/admin/directory/v1/users'
      );
      url.searchParams.set('domain', params.domain);
      url.searchParams.set('maxResults', '500');
      url.searchParams.set('projection', 'basic');
      if (params.orgUnitPath) {
        url.searchParams.set('query', `orgUnitPath='${params.orgUnitPath}'`);
      }
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await this.fetchJson<GoogleDirectoryUsersResponse>(
        url.toString(),
        { headers: { Authorization: `Bearer ${params.accessToken}` } }
      );

      if (response.users?.length) {
        users.push(...response.users);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return users
      .filter(user => !user.suspended)
      .map(user => ({
        externalId: user.id,
        primaryEmail: user.primaryEmail,
        suspended: user.suspended,
        orgUnitPath: user.orgUnitPath,
      }));
  }

  async listGroups(params: DirectoryProviderListGroupsParams) {
    const groups: GoogleDirectoryGroup[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        'https://admin.googleapis.com/admin/directory/v1/groups'
      );
      url.searchParams.set('domain', params.domain);
      url.searchParams.set('maxResults', '200');
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await this.fetchJson<GoogleDirectoryGroupsResponse>(
        url.toString(),
        { headers: { Authorization: `Bearer ${params.accessToken}` } }
      );

      if (response.groups?.length) {
        groups.push(...response.groups);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return groups.map(group => ({
      externalId: group.id,
      email: group.email,
      name: group.name,
    }));
  }

  async listGroupMembers(params: DirectoryProviderListGroupMembersParams) {
    const members: GoogleDirectoryMember[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(params.groupKey)}/members`
      );
      url.searchParams.set('maxResults', '200');
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await this.fetchJson<GoogleDirectoryMembersResponse>(
        url.toString(),
        { headers: { Authorization: `Bearer ${params.accessToken}` } }
      );

      if (response.members?.length) {
        members.push(...response.members);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return members
      .filter(member => member.type === 'USER' && member.status === 'ACTIVE')
      .map(member => ({
        externalId: member.id,
        primaryEmail: member.email,
      }));
  }

  async listOrgUnits(params: DirectoryProviderListOrgUnitsParams) {
    const url = new URL(
      'https://admin.googleapis.com/admin/directory/v1/customer/my_customer/orgunits'
    );
    url.searchParams.set('type', 'all');

    const response = await this.fetchJson<GoogleOrgUnitsResponse>(
      url.toString(),
      { headers: { Authorization: `Bearer ${params.accessToken}` } }
    );

    return (response.organizationUnits ?? []).map(ou => ({
      externalId: ou.orgUnitId,
      path: ou.orgUnitPath,
      name: ou.name,
    }));
  }
}
