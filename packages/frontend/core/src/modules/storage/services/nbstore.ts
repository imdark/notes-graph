import { Service } from '@notesgraph/infra';
import type { WorkerInitOptions } from '@notesgraph/nbstore/worker/client';

import type { NbstoreProvider } from '../providers/nbstore';

export class NbstoreService extends Service {
  constructor(private readonly nbstoreProvider: NbstoreProvider) {
    super();
  }

  openStore(key: string, options: WorkerInitOptions) {
    return this.nbstoreProvider.openStore(key, options);
  }

  get realtime() {
    return this.nbstoreProvider.realtime;
  }
}
