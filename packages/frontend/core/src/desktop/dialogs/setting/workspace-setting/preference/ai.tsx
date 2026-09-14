import { Switch } from '@notesgraph/component';
import {
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { LocalAiSetting } from '@notesgraph/core/modules/ai-local';
import { ServerService } from '@notesgraph/core/modules/cloud';
import { WorkspacePermissionService } from '@notesgraph/core/modules/permissions';
import { WorkspaceShareSettingService } from '@notesgraph/core/modules/share-setting';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

export const AiSetting = () => {
  const t = useI18n();
  const shareSetting = useService(WorkspaceShareSettingService).sharePreview;
  const serverService = useService(ServerService);
  const serverEnableAi = useLiveData(
    serverService.server.features$.map(f => f?.copilot)
  );
  const workspaceEnableAi = useLiveData(shareSetting.enableAi$);
  const loading = useLiveData(shareSetting.isLoading$);
  const permissionService = useService(WorkspacePermissionService);
  const isOwner = useLiveData(permissionService.permission.isOwner$);

  const toggleAi = useAsyncCallback(
    async (checked: boolean) => {
      await shareSetting.setEnableAi(checked);
    },
    [shareSetting]
  );

  return (
    <>
      {isOwner && serverEnableAi ? (
        <SettingWrapper
          title={t['com.notesgraph.settings.workspace.notesgraph-ai.title']()}
        >
          <SettingRow
            name={t['com.notesgraph.settings.workspace.notesgraph-ai.label']()}
            desc={t[
              'com.notesgraph.settings.workspace.notesgraph-ai.description'
            ]()}
          >
            <Switch
              checked={!!workspaceEnableAi}
              onChange={toggleAi}
              disabled={loading}
            />
          </SettingRow>
        </SettingWrapper>
      ) : null}
      <LocalAiSetting />
    </>
  );
};
