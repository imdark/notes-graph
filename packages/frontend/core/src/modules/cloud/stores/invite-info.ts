import { getInviteInfoQuery } from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';

import type { GraphQLService } from '../services/graphql';

export class InviteInfoStore extends Store {
  constructor(private readonly gqlService: GraphQLService) {
    super();
  }

  async getInviteInfo(inviteId?: string, signal?: AbortSignal) {
    if (!inviteId) {
      throw new Error('No inviteId');
    }
    const data = await this.gqlService.gql({
      query: getInviteInfoQuery,
      variables: {
        inviteId,
      },
      context: { signal },
    });

    return data.getInviteInfo;
  }
}
