import { acceptInviteByInviteIdMutation } from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';

import type { GraphQLService } from '../services/graphql';

export class AcceptInviteStore extends Store {
  constructor(private readonly gqlService: GraphQLService) {
    super();
  }

  async acceptInvite(
    workspaceId: string,
    inviteId: string,
    signal?: AbortSignal
  ) {
    const data = await this.gqlService.gql({
      query: acceptInviteByInviteIdMutation,

      variables: {
        workspaceId,
        inviteId,
      },
      context: { signal },
    });

    return data.acceptInviteById;
  }
}
