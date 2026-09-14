import type { OpSchema } from '@notesgraph/infra/op';

export interface WorkerOps extends OpSchema {
  renderWorkspaceProfile: [Uint8Array[], { name?: string; avatar?: string }];
}
