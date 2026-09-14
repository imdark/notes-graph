import { type DropTargetDropEvent, useDropTarget } from '@notesgraph/component';
import type { NotesGraphDNDData } from '@notesgraph/core/types/dnd';
import { useI18n } from '@notesgraph/i18n';

import { EmptyNodeChildren } from '../../layouts/empty-node-children';

export const Empty = ({
  onDrop,
}: {
  onDrop: (data: DropTargetDropEvent<NotesGraphDNDData>) => void;
}) => {
  const { dropTargetRef } = useDropTarget(
    () => ({
      onDrop,
    }),
    [onDrop]
  );
  const t = useI18n();
  return (
    <EmptyNodeChildren ref={dropTargetRef}>
      {t['com.notesgraph.collection.emptyCollection']()}
    </EmptyNodeChildren>
  );
};
