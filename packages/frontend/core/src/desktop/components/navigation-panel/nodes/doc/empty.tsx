import { type DropTargetDropEvent, useDropTarget } from '@notesgraph/component';
import type { NotesGraphDNDData } from '@notesgraph/core/types/dnd';
import { useI18n } from '@notesgraph/i18n';

import { EmptyNodeChildren } from '../../layouts/empty-node-children';

export const Empty = ({
  onDrop,
  noAccessible = false,
}: {
  onDrop: (data: DropTargetDropEvent<NotesGraphDNDData>) => void;
  noAccessible?: boolean;
}) => {
  const { dropTargetRef } = useDropTarget<NotesGraphDNDData>(
    () => ({
      onDrop,
    }),
    [onDrop]
  );
  const t = useI18n();

  return (
    <EmptyNodeChildren ref={dropTargetRef}>
      {noAccessible
        ? t['com.notesgraph.share-menu.option.permission.no-access']()
        : t['com.notesgraph.rootAppSidebar.docs.no-subdoc']()}
    </EmptyNodeChildren>
  );
};
