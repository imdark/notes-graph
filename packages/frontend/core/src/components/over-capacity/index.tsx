import { notify } from '@notesgraph/component';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { WorkspacePermissionService } from '@notesgraph/core/modules/permissions';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import type { BlobSyncState } from '@notesgraph/nbstore';
import { debounce } from 'lodash-es';
import { useCallback, useEffect } from 'react';

/**
 * TODO(eyhn): refactor this
 */
export const OverCapacityNotification = () => {
  const t = useI18n();
  const currentWorkspace = useService(WorkspaceService).workspace;
  const permissionService = useService(WorkspacePermissionService);
  const isOwner = useLiveData(permissionService.permission.isOwner$);
  useEffect(() => {
    // revalidate permission
    permissionService.permission.revalidate();
  }, [permissionService]);

  const workspaceDialogService = useService(WorkspaceDialogService);
  const jumpToPricePlan = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'plans',
      scrollAnchor: 'cloudPricingPlan',
    });
  }, [workspaceDialogService]);

  // debounce sync engine status
  useEffect(() => {
    const disposableOverCapacity =
      currentWorkspace.engine.blob.state$.subscribe(
        debounce(({ overCapacity }: BlobSyncState) => {
          const isOver = overCapacity;
          if (!isOver) {
            return;
          }
          if (isOwner) {
            notify.warning({
              title: t['com.notesgraph.payment.storage-limit.new-title'](),
              message:
                t[
                  'com.notesgraph.payment.storage-limit.new-description.owner'
                ](),
              actions: [
                {
                  key: 'upgrade',
                  label: t['com.notesgraph.payment.upgrade'](),
                  onClick: jumpToPricePlan,
                },
              ],
            });
          } else {
            notify.warning({
              title: t['com.notesgraph.payment.storage-limit.new-title'](),
              message:
                t['com.notesgraph.payment.storage-limit.description.member'](),
            });
          }
        })
      );
    return () => {
      disposableOverCapacity?.unsubscribe();
    };
  }, [currentWorkspace, isOwner, jumpToPricePlan, t]);

  return null;
};
