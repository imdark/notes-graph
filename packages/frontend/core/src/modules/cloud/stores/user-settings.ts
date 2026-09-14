import {
  type UpdateUserSettingsInput,
  updateUserSettingsMutation,
} from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';
import type { UserSettingsSnapshot } from '@notesgraph/realtime';

import type { NbstoreService } from '../../storage';
import type { GraphQLService } from '../services/graphql';

export type UserSettings = UserSettingsSnapshot;

export type { UpdateUserSettingsInput };

export class UserSettingsStore extends Store {
  constructor(
    private readonly gqlService: GraphQLService,
    private readonly nbstoreService: NbstoreService
  ) {
    super();
  }

  async getUserSettings(
    signal?: AbortSignal
  ): Promise<UserSettings | undefined> {
    const { settings } = await this.nbstoreService.realtime.request(
      'user.settings.get',
      {},
      { signal, timeoutMs: 10000 }
    );
    return settings;
  }

  subscribeUserSettings() {
    return this.nbstoreService.realtime.subscribe('user.settings.changed', {});
  }

  async updateUserSettings(settings: UpdateUserSettingsInput) {
    await this.gqlService.gql({
      query: updateUserSettingsMutation,
      variables: {
        input: settings,
      },
    });
  }
}
