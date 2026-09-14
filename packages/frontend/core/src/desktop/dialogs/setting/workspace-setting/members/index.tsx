import { Button, Tooltip } from '@notesgraph/component';
import { SettingRow } from '@notesgraph/component/setting-components';
import { useWorkspaceInfo } from '@notesgraph/core/components/hooks/use-workspace-info';
import { NotesGraphErrorBoundary } from '@notesgraph/core/components/notesgraph/notesgraph-error-boundary';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import type { ReactElement } from 'react';

import type { SettingState } from '../../types';
import { EnableCloudPanel } from '../preference/enable-cloud';
import { CloudWorkspaceMembersPanel } from './cloud-members-panel';
import * as styles from './styles.css';

export const MembersPanel = ({
  onChangeSettingState,
  onCloseSetting,
}: {
  onChangeSettingState: (settingState: SettingState) => void;
  onCloseSetting: () => void;
}): ReactElement | null => {
  const workspace = useService(WorkspaceService).workspace;
  const isTeam = useWorkspaceInfo(workspace.meta)?.isTeam;
  if (workspace.flavour === 'local') {
    return <MembersPanelLocal onCloseSetting={onCloseSetting} />;
  }
  return (
    <NotesGraphErrorBoundary>
      <CloudWorkspaceMembersPanel
        onChangeSettingState={onChangeSettingState}
        isTeam={isTeam}
      />
    </NotesGraphErrorBoundary>
  );
};

const MembersPanelLocal = ({
  onCloseSetting,
}: {
  onCloseSetting: () => void;
}) => {
  const t = useI18n();
  return (
    <div className={styles.localMembersPanel}>
      <Tooltip content={t['com.notesgraph.settings.member-tooltip']()}>
        <div className={styles.fakeWrapper}>
          <SettingRow name={`${t['Members']()} (0)`} desc={t['Members hint']()}>
            <Button>{t['Invite Members']()}</Button>
          </SettingRow>
        </div>
      </Tooltip>
      <EnableCloudPanel onCloseSetting={onCloseSetting} />
    </div>
  );
};
