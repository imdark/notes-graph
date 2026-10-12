import type { BlockStdScope } from '@blocksuite/std';
import { ObjectPool, Service } from '@notesgraph/infra';

import { DocCommentEntity } from '../entities/doc-comment';

type DocId = string;

export class DocCommentManagerService extends Service {
  constructor() {
    super();
  }

  std: BlockStdScope | null = null;

  private readonly pool = new ObjectPool<DocId, DocCommentEntity>({
    onDelete: entity => {
      entity.dispose();
    },
  });

  get(docId: DocId) {
    let commentRef = this.pool.get(docId);
    if (!commentRef) {
      // `std` is read through the trap, never from the target: the pooled
      // entity outlives the editor that created it and must not pin it.
      const props = new Proxy(
        {
          docId,
          std: null as BlockStdScope | null,
        },
        {
          get: (target, prop) => {
            if (prop === 'std') {
              return this.std;
            }
            return target[prop as keyof typeof target];
          },
        }
      );
      const comment = this.framework.createEntity(DocCommentEntity, props);
      commentRef = this.pool.put(docId, comment);
      // todo: add LRU cache for the pool?
    }
    return commentRef;
  }
}
