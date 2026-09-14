import { Button } from '@notesgraph/component';
import {
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { useI18n } from '@notesgraph/i18n';

export const Preferences = () => {
  const t = useI18n();
  return (
    <SettingWrapper
      title={t['com.notesgraph.settings.editorSettings.preferences']()}
    >
      <SettingRow
        name={t[
          'com.notesgraph.settings.editorSettings.preferences.export.title'
        ]()}
        desc={t[
          'com.notesgraph.settings.editorSettings.preferences.export.description'
        ]()}
      >
        <Button>Export</Button>
      </SettingRow>
      <SettingRow
        name={t[
          'com.notesgraph.settings.editorSettings.preferences.import.title'
        ]()}
        desc={t[
          'com.notesgraph.settings.editorSettings.preferences.import.description'
        ]()}
      >
        <Button>Import</Button>
      </SettingRow>
    </SettingWrapper>
  );
};
