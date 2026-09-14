import type { NotesGraphDNDEntity } from '@notesgraph/core/types/dnd';

export const allowedSplitViewEntityTypes: Set<NotesGraphDNDEntity['type']> =
  new Set(['doc', 'collection', 'tag']);

export const inferToFromEntity = (entity: NotesGraphDNDEntity) => {
  if (entity.type === 'doc') {
    return `/${entity.id}`;
  } else if (entity.type === 'collection') {
    return `/collection/${entity.id}`;
  } else if (entity.type === 'tag') {
    return `/tag/${entity.id}`;
  }
  return null;
};
