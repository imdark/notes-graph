import { OverlayModal } from '@notesgraph/component';
import { useEnableCloud } from '@notesgraph/core/components/hooks/notesgraph/use-enable-cloud';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import TopSvg from './top-svg';

export const HistoryTipsModal = ({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  const t = useI18n();
  const currentWorkspace = useService(WorkspaceService).workspace;
  const confirmEnableCloud = useEnableCloud();

  const handleConfirm = useCallback(() => {
    setOpen(false);
    confirmEnableCloud(currentWorkspace);
  }, [confirmEnableCloud, currentWorkspace, setOpen]);

  return (
    <OverlayModal
      open={open}
      topImage={<TopSvg />}
      title={t['com.notesgraph.history-vision.tips-modal.title']()}
      onOpenChange={setOpen}
      description={t['com.notesgraph.history-vision.tips-modal.description']()}
      cancelText={t['com.notesgraph.history-vision.tips-modal.cancel']()}
      confirmButtonOptions={{
        variant: 'primary',
      }}
      onConfirm={handleConfirm}
      confirmText={t['com.notesgraph.history-vision.tips-modal.confirm']()}
    />
  );
};
