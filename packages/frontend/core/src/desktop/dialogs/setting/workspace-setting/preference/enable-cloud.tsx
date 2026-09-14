import { SettingRow } from '@notesgraph/component/setting-components';
import { Button } from '@notesgraph/component/ui/button';
import { useEnableCloud } from '@notesgraph/core/components/hooks/notesgraph/use-enable-cloud';
import {
  type Workspace,
  WorkspaceService,
} from '@notesgraph/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@notesgraph/env/constant';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback } from 'react';

export interface PublishPanelProps {
  workspace: Workspace | null;
}

export const EnableCloudPanel = ({
  onCloseSetting,
}: {
  onCloseSetting?: () => void;
}) => {
  const t = useI18n();
  const confirmEnableCloud = useEnableCloud();

  const workspace = useService(WorkspaceService).workspace;
  const name = useLiveData(workspace.name$);
  const flavour = workspace.flavour;

  const confirmEnableCloudAndClose = useCallback(() => {
    if (!workspace) return;
    confirmEnableCloud(workspace, {
      onSuccess: () => {
        onCloseSetting?.();
      },
    });
  }, [confirmEnableCloud, onCloseSetting, workspace]);

  if (flavour !== 'local') {
    return null;
  }

  return (
    <SettingRow
      name={t['Workspace saved locally']({
        name: name ?? UNTITLED_WORKSPACE_NAME,
      })}
      desc={t['Enable cloud hint']()}
      spreadCol={false}
      style={{
        padding: '10px',
        background: 'var(--notesgraph-background-secondary-color)',
        marginTop: '24px',
      }}
    >
      <Button
        data-testid="publish-enable-notesgraph-cloud-button"
        variant="primary"
        onClick={confirmEnableCloudAndClose}
        style={{ marginTop: '12px' }}
      >
        {t['Enable NotesGraph Cloud']()}
      </Button>
    </SettingRow>
  );
};
