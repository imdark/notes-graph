import type { WorkspaceServerService } from '@notesgraph/core/modules/cloud';
import { getWorkspacePublicPagesQuery } from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';

export class ShareDocsStore extends Store {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  async getWorkspacesShareDocs(workspaceId: string, signal?: AbortSignal) {
    if (!this.workspaceServerService.server) {
      throw new Error('No Server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getWorkspacePublicPagesQuery,
      variables: {
        workspaceId: workspaceId,
      },
      context: {
        signal,
      },
    });
    return data.workspace.publicDocs;
  }
}
