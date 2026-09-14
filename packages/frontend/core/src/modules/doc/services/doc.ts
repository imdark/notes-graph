import { Service } from '@notesgraph/infra';

import { Doc } from '../entities/doc';

export class DocService extends Service {
  public readonly doc = this.framework.createEntity(Doc);

  override dispose() {
    this.doc.dispose();
    super.dispose();
  }
}
