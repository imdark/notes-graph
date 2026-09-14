import { SettingsIcon } from '@blocksuite/icons/rc';
import type { useI18n } from '@notesgraph/i18n';
import { appSettingAtom } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import type { createStore } from 'jotai';
import type { useTheme } from 'next-themes';

import type { EditorSettingService } from '../modules/editor-setting';
import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphSettingsCommands({
  t,
  store,
  theme,
  editorSettingService,
}: {
  t: ReturnType<typeof useI18n>;
  store: ReturnType<typeof createStore>;
  theme: ReturnType<typeof useTheme>;
  editorSettingService: EditorSettingService;
}) {
  const unsubs: Array<() => void> = [];
  const updateSettings = editorSettingService.editorSetting.set.bind(
    editorSettingService.editorSetting
  );
  const settings$ = editorSettingService.editorSetting.settings$;

  // color modes
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:change-color-mode-to-auto',
      label: `${t['com.notesgraph.cmdk.notesgraph.color-mode.to']()} ${t[
        'com.notesgraph.themeSettings.system'
      ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => theme.theme !== 'system',
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'theme',
          value: 'system',
        });
        theme.setTheme('system');
      },
    })
  );
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:change-color-mode-to-dark',
      label: `${t['com.notesgraph.cmdk.notesgraph.color-mode.to']()} ${t[
        'com.notesgraph.themeSettings.dark'
      ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => theme.theme !== 'dark',
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'theme',
          value: 'dark',
        });
        theme.setTheme('dark');
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:change-color-mode-to-light',
      label: `${t['com.notesgraph.cmdk.notesgraph.color-mode.to']()} ${t[
        'com.notesgraph.themeSettings.light'
      ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => theme.theme !== 'light',
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'theme',
          value: 'light',
        });

        theme.setTheme('light');
      },
    })
  );

  // Font styles
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:change-font-style-to-sans',
      label: `${t['com.notesgraph.cmdk.notesgraph.font-style.to']()} ${t[
        'com.notesgraph.appearanceSettings.fontStyle.sans'
      ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => settings$.value.fontFamily !== 'Sans',
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'fontStyle',
          value: 'Sans',
        });

        updateSettings('fontFamily', 'Sans');
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:change-font-style-to-serif',
      label: `${t['com.notesgraph.cmdk.notesgraph.font-style.to']()} ${t[
        'com.notesgraph.appearanceSettings.fontStyle.serif'
      ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => settings$.value.fontFamily !== 'Serif',
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'fontStyle',
          value: 'Serif',
        });

        updateSettings('fontFamily', 'Serif');
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:change-font-style-to-mono',
      label: `${t['com.notesgraph.cmdk.notesgraph.font-style.to']()} ${t[
        'com.notesgraph.appearanceSettings.fontStyle.mono'
      ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => settings$.value.fontFamily !== 'Mono',
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'fontStyle',
          value: 'Mono',
        });

        updateSettings('fontFamily', 'Mono');
      },
    })
  );

  // Layout Style
  unsubs.push(
    registerNotesGraphCommand({
      id: `notesgraph:change-client-border-style`,
      label:
        () => `${t['com.notesgraph.cmdk.notesgraph.client-border-style.to']()} ${t[
          store.get(appSettingAtom).clientBorder
            ? 'com.notesgraph.cmdk.notesgraph.switch-state.off'
            : 'com.notesgraph.cmdk.notesgraph.switch-state.on'
        ]()}
        `,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => BUILD_CONFIG.isElectron,
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'clientBorder',
          value: store.get(appSettingAtom).clientBorder ? 'off' : 'on',
        });
        store.set(appSettingAtom, prev => ({
          ...prev,
          clientBorder: !prev.clientBorder,
        }));
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: `notesgraph:change-full-width-layout`,
      label: () =>
        `${t[
          settings$.value.fullWidthLayout
            ? 'com.notesgraph.cmdk.notesgraph.default-page-width-layout.standard'
            : 'com.notesgraph.cmdk.notesgraph.default-page-width-layout.full-width'
        ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'fullWidthLayout',
          value: settings$.value.fullWidthLayout ? 'off' : 'on',
        });
        updateSettings('fullWidthLayout', !settings$.value.fullWidthLayout);
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: `notesgraph:change-noise-background-on-the-sidebar`,
      label: () =>
        `${t[
          'com.notesgraph.cmdk.notesgraph.noise-background-on-the-sidebar.to'
        ]()} ${t[
          store.get(appSettingAtom).enableNoisyBackground
            ? 'com.notesgraph.cmdk.notesgraph.switch-state.off'
            : 'com.notesgraph.cmdk.notesgraph.switch-state.on'
        ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () => BUILD_CONFIG.isElectron,
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'enableNoisyBackground',
          value: store.get(appSettingAtom).enableNoisyBackground ? 'off' : 'on',
        });

        store.set(appSettingAtom, prev => ({
          ...prev,
          enableNoisyBackground: !prev.enableNoisyBackground,
        }));
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: `notesgraph:change-translucent-ui-on-the-sidebar`,
      label: () =>
        `${t['com.notesgraph.cmdk.notesgraph.translucent-ui-on-the-sidebar.to']()} ${t[
          store.get(appSettingAtom).enableBlurBackground
            ? 'com.notesgraph.cmdk.notesgraph.switch-state.off'
            : 'com.notesgraph.cmdk.notesgraph.switch-state.on'
        ]()}`,
      category: 'notesgraph:settings',
      icon: <SettingsIcon />,
      preconditionStrategy: () =>
        BUILD_CONFIG.isElectron && environment.isMacOs,
      run() {
        track.$.cmdk.settings.changeAppSetting({
          key: 'enableBlurBackground',
          value: store.get(appSettingAtom).enableBlurBackground ? 'off' : 'on',
        });
        store.set(appSettingAtom, prev => ({
          ...prev,
          enableBlurBackground: !prev.enableBlurBackground,
        }));
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
