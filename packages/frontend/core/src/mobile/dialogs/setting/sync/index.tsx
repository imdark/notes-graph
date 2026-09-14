import { Switch } from '@notesgraph/component';
import {
  BACKGROUND_SYNC_ENABLED_KEY,
  DEFAULT_BACKGROUND_SYNC_ENABLED,
} from '@notesgraph/core/modules/background-sync';
import { GlobalStateService } from '@notesgraph/core/modules/storage';
import { useI18n } from '@notesgraph/i18n';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';

/**
 * Mobile setting: toggle background push-sync. Persisted in GlobalState under
 * {@link BACKGROUND_SYNC_ENABLED_KEY} so the native background task's headless
 * sync honors it.
 */
export const SyncGroup = () => {
  const t = useI18n();
  const globalState = useService(GlobalStateService).globalState;

  const enabled = useLiveData(
    useMemo(
      () =>
        LiveData.from(
          globalState.watch<boolean>(BACKGROUND_SYNC_ENABLED_KEY),
          undefined
        ).map(value => value ?? DEFAULT_BACKGROUND_SYNC_ENABLED),
      [globalState]
    )
  );

  const onChange = useCallback(
    (checked: boolean) => {
      globalState.set(BACKGROUND_SYNC_ENABLED_KEY, checked);
    },
    [globalState]
  );

  return (
    <SettingGroup title={t['com.notesgraph.mobile.setting.sync.title']()}>
      <RowLayout
        label={t['com.notesgraph.mobile.setting.sync.background.title']()}
      >
        <Switch checked={enabled} onChange={onChange} />
      </RowLayout>
    </SettingGroup>
  );
};
