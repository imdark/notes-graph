import {
  PreconditionStrategy,
  registerNotesGraphCommand,
} from '@notesgraph/core/commands';
import { useSharingUrl } from '@notesgraph/core/components/hooks/notesgraph/use-share-url';
import { getDefaultShareMode } from '@notesgraph/core/components/hooks/notesgraph/use-share-url.utils';
import { EditorService } from '@notesgraph/core/modules/editor';
import { useIsActiveView } from '@notesgraph/core/modules/workbench';
import type { WorkspaceMetadata } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useEffect } from 'react';

export function useRegisterCopyLinkCommands({
  workspaceMeta,
  docId,
}: {
  workspaceMeta: WorkspaceMetadata;
  docId: string;
}) {
  const isActiveView = useIsActiveView();
  const workspaceId = workspaceMeta.id;
  const isCloud = workspaceMeta.flavour !== 'local';
  const currentMode = useLiveData(useService(EditorService).editor.mode$);

  const { onClickCopyLink } = useSharingUrl({
    workspaceId,
    pageId: docId,
  });

  useEffect(() => {
    if (!isActiveView) {
      return;
    }
    const unsubs: Array<() => void> = [];

    unsubs.push(
      registerNotesGraphCommand({
        id: `notesgraph:share-private-link:${docId}`,
        category: 'notesgraph:general',
        preconditionStrategy: PreconditionStrategy.Never,
        keyBinding: {
          binding: '$mod+Shift+c',
        },
        label: '',
        icon: null,
        run() {
          track.$.cmdk.general.copyShareLink();
          isActiveView &&
            isCloud &&
            onClickCopyLink(getDefaultShareMode(currentMode));
        },
      })
    );
    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [currentMode, docId, isActiveView, isCloud, onClickCopyLink]);
}
