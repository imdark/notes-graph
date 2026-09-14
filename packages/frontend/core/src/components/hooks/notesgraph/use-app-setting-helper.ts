import type { AppSetting } from '@notesgraph/infra';
import { appSettingAtom } from '@notesgraph/infra';
import { useAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

export function useAppSettingHelper() {
  const [appSettings, setAppSettings] = useAtom(appSettingAtom);

  const updateSettings = useCallback(
    <K extends keyof AppSetting>(key: K, value: AppSetting[K]) => {
      setAppSettings(prevSettings => ({ ...prevSettings, [key]: value }));
    },
    [setAppSettings]
  );

  return useMemo(
    () => ({
      appSettings,
      updateSettings,
    }),
    [appSettings, updateSettings]
  );
}
