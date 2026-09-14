import { copilotQuotaQuery } from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';

import type { GraphQLService } from '../services/graphql';

export class UserCopilotQuotaStore extends Store {
  constructor(private readonly graphqlService: GraphQLService) {
    super();
  }

  async fetchUserCopilotQuota(abortSignal?: AbortSignal) {
    const data = await this.graphqlService.gql({
      query: copilotQuotaQuery,
      context: {
        signal: abortSignal,
      },
    });

    if (!data.currentUser) {
      throw new Error('No logged in');
    }

    return data.currentUser.copilot.quota;
  }
}
