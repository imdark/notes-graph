import { Switch } from '@notesgraph/component';
import { AppLockService } from '@notesgraph/core/modules/app-lock';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useEffect, useState } from 'react';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';

/**
 * Mobile setting: lock the app behind the device PIN/biometric. Rendered only
 * where the platform provides an app lock (the Android app); elsewhere there
 * is no provider and this is nothing.
 */
export const SecurityGroup = () => {
  const t = useI18n();
  const appLock = useService(AppLockService);
  const state = useLiveData(appLock.state$);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    appLock.revalidate().catch(console.error);
  }, [appLock]);

  const onChange = useCallback(
    (checked: boolean) => {
      // Turning it on raises the system unlock prompt; the switch follows the
      // outcome (a cancelled prompt leaves it off), not the tap.
      setBusy(true);
      appLock
        .setEnabled(checked)
        .catch(console.error)
        .finally(() => setBusy(false));
    },
    [appLock]
  );

  if (!appLock.supported || !state) return null;

  return (
    <SettingGroup title={t['com.notesgraph.mobile.setting.security.title']()}>
      <RowLayout
        label={
          <div>
            {t['com.notesgraph.mobile.setting.security.app-lock']()}
            {state.available ? null : (
              <div
                style={{
                  fontSize: 12,
                  color: cssVarV2('text/secondary'),
                  marginTop: 2,
                }}
              >
                {t[
                  'com.notesgraph.mobile.setting.security.app-lock.unavailable'
                ]()}
              </div>
            )}
          </div>
        }
      >
        <Switch
          checked={state.enabled}
          disabled={busy || (!state.available && !state.enabled)}
          onChange={onChange}
        />
      </RowLayout>
    </SettingGroup>
  );
};
