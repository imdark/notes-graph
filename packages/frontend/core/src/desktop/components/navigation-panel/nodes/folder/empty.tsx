import {
  type DropTargetDropEvent,
  type DropTargetOptions,
  useDropTarget,
} from '@notesgraph/component';
import type { NotesGraphDNDData } from '@notesgraph/core/types/dnd';
import { useI18n } from '@notesgraph/i18n';

import { EmptyNodeChildren } from '../../layouts/empty-node-children';
import { draggedOverHighlight } from './empty.css';

export const FolderEmpty = ({
  canDrop,
  onDrop,
}: {
  onDrop?: (data: DropTargetDropEvent<NotesGraphDNDData>) => void;
  canDrop?: DropTargetOptions<NotesGraphDNDData>['canDrop'];
}) => {
  const { dropTargetRef } = useDropTarget(
    () => ({
      onDrop,
      canDrop,
    }),
    [onDrop, canDrop]
  );

  const t = useI18n();
  return (
    <EmptyNodeChildren ref={dropTargetRef} className={draggedOverHighlight}>
      {t['com.notesgraph.rootAppSidebar.organize.empty-folder']()}
    </EmptyNodeChildren>
  );
};
