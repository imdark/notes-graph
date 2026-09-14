import { Scope } from '@notesgraph/infra';
import type { WorkerInitOptions } from '@notesgraph/nbstore/worker/client';

import type { WorkspaceOpenOptions } from '../open-options';

export class WorkspaceScope extends Scope<{
  openOptions: WorkspaceOpenOptions;
  engineWorkerInitOptions: WorkerInitOptions;
}> {}
