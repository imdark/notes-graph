import type { Store } from '@blocksuite/notesgraph/store';
import { Scope } from '@notesgraph/infra';

import type { DocRecord } from '../entities/record';

export class DocScope extends Scope<{
  docId: string;
  record: DocRecord;
  blockSuiteDoc: Store;
}> {}
