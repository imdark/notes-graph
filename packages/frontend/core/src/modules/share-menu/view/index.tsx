import type { Store } from '@blocksuite/notesgraph/store';
import { useEnableCloud } from '@notesgraph/core/components/hooks/notesgraph/use-enable-cloud';
import { WorkspaceShareSettingService } from '@notesgraph/core/modules/share-setting';
import type { Workspace } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useEffect } from 'react';

import { ShareMenu } from './share-menu';
export { CloudSvg } from './cloud-svg';
export { ShareMenuContent } from './share-menu';

type SharePageModalProps = {
  workspace: Workspace;
  page: Store;
};

export const SharePageButton = ({ workspace, page }: SharePageModalProps) => {
  const t = useI18n();
  const shareSetting = useService(WorkspaceShareSettingService).sharePreview;
  const enableSharing = useLiveData(shareSetting.enableSharing$);

  const confirmEnableCloud = useEnableCloud();
  const handleOpenShareModal = useCallback((open: boolean) => {
    if (open) {
      track.$.sharePanel.$.open();
    }
  }, []);

  useEffect(() => {
    if (workspace.meta.flavour === 'local') {
      return;
    }
    shareSetting.revalidate();
  }, [shareSetting, workspace.meta.flavour]);

  const sharingDisabled = enableSharing === false;
  const disabledReason = sharingDisabled
    ? t['com.notesgraph.share-menu.workspace-sharing.disabled.tooltip']()
    : undefined;

  return (
    <ShareMenu
      workspaceMetadata={workspace.meta}
      currentPage={page}
      onEnableNotesGraphCloud={() =>
        confirmEnableCloud(workspace, {
          openPageId: page.id,
        })
      }
      onOpenShareModal={handleOpenShareModal}
      disabled={sharingDisabled}
      disabledReason={disabledReason}
    />
  );
};
