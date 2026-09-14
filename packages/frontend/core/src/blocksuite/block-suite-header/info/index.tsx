import { InformationIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@notesgraph/component';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback } from 'react';

export const InfoButton = ({ docId }: { docId: string }) => {
  const workspaceDialogService = useService(WorkspaceDialogService);
  const t = useI18n();

  const onOpenInfoModal = useCallback(() => {
    track.$.header.actions.openDocInfo();
    workspaceDialogService.open('doc-info', { docId });
  }, [docId, workspaceDialogService]);

  return (
    <IconButton
      size="20"
      tooltip={t['com.notesgraph.page-properties.page-info.view']()}
      data-testid="header-info-button"
      onClick={onOpenInfoModal}
    >
      <InformationIcon />
    </IconButton>
  );
};
