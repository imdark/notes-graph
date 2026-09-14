import { SettingsIcon } from '@blocksuite/icons/rc';
import type { I18n } from '@notesgraph/core/modules/i18n';
import type { useI18n } from '@notesgraph/i18n';
import { track } from '@notesgraph/track';

import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphLanguageCommands({
  i18n,
  t,
}: {
  i18n: I18n;
  t: ReturnType<typeof useI18n>;
}) {
  // Display Language
  const disposables = i18n.languageList.map(language => {
    return registerNotesGraphCommand({
      id: `notesgraph:change-display-language-to-${language.name}`,
      label: `${t['com.notesgraph.cmdk.notesgraph.display-language.to']()} ${
        language.originalName
      }`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () =>
        i18n.currentLanguage$.value.key !== language.key,
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'language',
          value: language.name,
        });

        i18n.changeLanguage(language.key);
      },
    });
  });

  return () => {
    disposables.forEach(dispose => dispose());
  };
}
