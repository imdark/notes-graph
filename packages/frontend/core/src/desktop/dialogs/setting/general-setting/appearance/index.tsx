import type { RadioItem } from '@notesgraph/component';
import { RadioGroup, Switch } from '@notesgraph/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { LanguageMenu } from '@notesgraph/core/components/notesgraph/language-menu';
import { AppSidebarService } from '@notesgraph/core/modules/app-sidebar';
import { TraySettingService } from '@notesgraph/core/modules/editor-setting/services/tray-settings';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useTheme } from 'next-themes';
import { useCallback, useMemo } from 'react';

import { useAppSettingHelper } from '../../../../../components/hooks/notesgraph/use-app-setting-helper';
import { OpenInAppLinksMenu } from './links';
import { settingWrapper } from './style.css';
import { ThemeEditorSetting } from './theme-editor-setting';
import { ThemesGallery } from './themes-gallery';

export const getThemeOptions = (t: ReturnType<typeof useI18n>) =>
  [
    {
      value: 'system',
      label: t['com.notesgraph.themeSettings.system'](),
      testId: 'system-theme-trigger',
    },
    {
      value: 'light',
      label: t['com.notesgraph.themeSettings.light'](),
      testId: 'light-theme-trigger',
    },
    {
      value: 'dark',
      label: t['com.notesgraph.themeSettings.dark'](),
      testId: 'dark-theme-trigger',
    },
  ] satisfies RadioItem[];

export const ThemeSettings = () => {
  const t = useI18n();
  const { setTheme, theme } = useTheme();

  const radioItems = useMemo<RadioItem[]>(() => getThemeOptions(t), [t]);

  return (
    <RadioGroup
      items={radioItems}
      value={theme}
      width={250}
      className={settingWrapper}
      onChange={useCallback(
        (value: string) => {
          setTheme(value);
        },
        [setTheme]
      )}
    />
  );
};

const MenubarSetting = () => {
  const t = useI18n();
  const traySettingService = useService(TraySettingService);
  const traySetting = useLiveData(traySettingService.settings$);

  return (
    <>
      <SettingWrapper
        id="menubar"
        title={t['com.notesgraph.appearanceSettings.menubar.title']()}
      >
        <SettingRow
          name={t['com.notesgraph.appearanceSettings.menubar.toggle']()}
          desc={t['com.notesgraph.appearanceSettings.menubar.description']()}
        >
          <Switch
            checked={traySetting.enabled}
            onChange={checked => traySettingService.setEnabled(checked)}
          />
        </SettingRow>
      </SettingWrapper>
      {traySetting.enabled && !environment.isMacOs ? (
        <SettingWrapper
          id="windowBehavior"
          title={t[
            'com.notesgraph.appearanceSettings.menubar.windowBehavior.title'
          ]()}
        >
          <SettingRow
            name={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.openOnLeftClick.toggle'
            ]()}
            desc={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.openOnLeftClick.description'
            ]()}
          >
            <Switch
              checked={traySetting.openOnLeftClick}
              onChange={checked =>
                traySettingService.setOpenOnLeftClick(checked)
              }
            />
          </SettingRow>
          <SettingRow
            name={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.minimizeToTray.toggle'
            ]()}
            desc={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.minimizeToTray.description'
            ]()}
          >
            <Switch
              checked={traySetting.minimizeToTray}
              onChange={checked =>
                traySettingService.setMinimizeToTray(checked)
              }
            />
          </SettingRow>
          <SettingRow
            name={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.closeToTray.toggle'
            ]()}
            desc={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.closeToTray.description'
            ]()}
          >
            <Switch
              checked={traySetting.closeToTray}
              onChange={checked => traySettingService.setCloseToTray(checked)}
            />
          </SettingRow>
          <SettingRow
            name={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.startMinimized.toggle'
            ]()}
            desc={t[
              'com.notesgraph.appearanceSettings.menubar.windowBehavior.startMinimized.description'
            ]()}
          >
            <Switch
              checked={traySetting.startMinimized}
              onChange={checked =>
                traySettingService.setStartMinimized(checked)
              }
            />
          </SettingRow>
        </SettingWrapper>
      ) : null}
    </>
  );
};

const SidebarSectionsSetting = () => {
  const t = useI18n();
  const appSidebar = useService(AppSidebarService).sidebar;
  const showNotes = useLiveData(appSidebar.showNotes$);
  const showFavorites = useLiveData(appSidebar.showFavorites$);
  const showTags = useLiveData(appSidebar.showTags$);
  const showCollections = useLiveData(appSidebar.showCollections$);
  const showProjects = useLiveData(appSidebar.showProjects$);

  return (
    <>
      <SettingRow
        name={t['com.notesgraph.appearanceSettings.sidebarNotes.title']()}
        desc={t['com.notesgraph.appearanceSettings.sidebarNotes.description']()}
        data-testid="sidebar-notes-trigger"
      >
        <Switch
          checked={showNotes}
          onChange={checked => appSidebar.setShowNotes(checked)}
        />
      </SettingRow>
      <SettingRow
        name={t['com.notesgraph.appearanceSettings.sidebarFavorites.title']()}
        desc={t[
          'com.notesgraph.appearanceSettings.sidebarFavorites.description'
        ]()}
        data-testid="sidebar-favorites-trigger"
      >
        <Switch
          checked={showFavorites}
          onChange={checked => appSidebar.setShowFavorites(checked)}
        />
      </SettingRow>
      <SettingRow
        name={t['com.notesgraph.appearanceSettings.sidebarTags.title']()}
        desc={t['com.notesgraph.appearanceSettings.sidebarTags.description']()}
        data-testid="sidebar-tags-trigger"
      >
        <Switch
          checked={showTags}
          onChange={checked => appSidebar.setShowTags(checked)}
        />
      </SettingRow>
      <SettingRow
        name={t['com.notesgraph.appearanceSettings.sidebarCollections.title']()}
        desc={t[
          'com.notesgraph.appearanceSettings.sidebarCollections.description'
        ]()}
        data-testid="sidebar-collections-trigger"
      >
        <Switch
          checked={showCollections}
          onChange={checked => appSidebar.setShowCollections(checked)}
        />
      </SettingRow>
      <SettingRow
        name={t['com.notesgraph.appearanceSettings.sidebarProjects.title']()}
        desc={t[
          'com.notesgraph.appearanceSettings.sidebarProjects.description'
        ]()}
        data-testid="sidebar-projects-trigger"
      >
        <Switch
          checked={showProjects}
          onChange={checked => appSidebar.setShowProjects(checked)}
        />
      </SettingRow>
    </>
  );
};

export const AppearanceSettings = () => {
  const t = useI18n();

  const featureFlagService = useService(FeatureFlagService);
  const enableThemeEditor = useLiveData(
    featureFlagService.flags.enable_theme_editor.$
  );
  const { appSettings, updateSettings } = useAppSettingHelper();

  return (
    <>
      <SettingHeader
        title={t['com.notesgraph.appearanceSettings.title']()}
        subtitle={t['com.notesgraph.appearanceSettings.subtitle']()}
      />

      <SettingWrapper
        title={t['com.notesgraph.appearanceSettings.theme.title']()}
      >
        <SettingRow
          name={t['com.notesgraph.appearanceSettings.color.title']()}
          desc={t['com.notesgraph.appearanceSettings.color.description']()}
        >
          <ThemeSettings />
        </SettingRow>
        <SettingRow
          name={t['com.notesgraph.appearanceSettings.language.title']()}
          desc={t['com.notesgraph.appearanceSettings.language.description']()}
        >
          <div className={settingWrapper}>
            <LanguageMenu />
          </div>
        </SettingRow>
        {BUILD_CONFIG.isElectron ? (
          <SettingRow
            name={t['com.notesgraph.appearanceSettings.clientBorder.title']()}
            desc={t[
              'com.notesgraph.appearanceSettings.clientBorder.description'
            ]()}
            data-testid="client-border-style-trigger"
          >
            <Switch
              checked={appSettings.clientBorder}
              onChange={checked => updateSettings('clientBorder', checked)}
            />
          </SettingRow>
        ) : null}
        {enableThemeEditor ? <ThemesGallery /> : null}
        {enableThemeEditor ? <ThemeEditorSetting /> : null}
      </SettingWrapper>

      <SettingWrapper
        title={t['com.notesgraph.appearanceSettings.images.title']()}
      >
        <SettingRow
          name={t[
            'com.notesgraph.appearanceSettings.images.antialiasing.title'
          ]()}
          desc={t[
            'com.notesgraph.appearanceSettings.images.antialiasing.description'
          ]()}
          data-testid="image-antialiasing-trigger"
        >
          <Switch
            checked={!appSettings.disableImageAntialiasing}
            onChange={checked =>
              updateSettings('disableImageAntialiasing', !checked)
            }
          />
        </SettingRow>
      </SettingWrapper>

      {BUILD_CONFIG.isWeb && !environment.isMobile ? (
        <SettingWrapper title={t['com.notesgraph.setting.appearance.links']()}>
          <SettingRow
            name={t['com.notesgraph.setting.appearance.open-in-app']()}
            desc={t['com.notesgraph.setting.appearance.open-in-app.hint']()}
            data-testid="open-in-app-links-trigger"
          >
            <OpenInAppLinksMenu />
          </SettingRow>
        </SettingWrapper>
      ) : null}

      <SettingWrapper
        title={t['com.notesgraph.appearanceSettings.sidebar.title']()}
      >
        {BUILD_CONFIG.isElectron ? (
          <SettingRow
            name={t[
              'com.notesgraph.appearanceSettings.noisyBackground.title'
            ]()}
            desc={t[
              'com.notesgraph.appearanceSettings.noisyBackground.description'
            ]()}
          >
            <Switch
              checked={appSettings.enableNoisyBackground}
              onChange={checked =>
                updateSettings('enableNoisyBackground', checked)
              }
            />
          </SettingRow>
        ) : null}
        {BUILD_CONFIG.isElectron && environment.isMacOs && (
          <SettingRow
            name={t['com.notesgraph.appearanceSettings.translucentUI.title']()}
            desc={t[
              'com.notesgraph.appearanceSettings.translucentUI.description'
            ]()}
          >
            <Switch
              checked={appSettings.enableBlurBackground}
              onChange={checked =>
                updateSettings('enableBlurBackground', checked)
              }
            />
          </SettingRow>
        )}
        <SettingRow
          name={t[
            'com.notesgraph.appearanceSettings.showLinkedDocInSidebar.title'
          ]()}
          desc={t[
            'com.notesgraph.appearanceSettings.showLinkedDocInSidebar.description'
          ]()}
        >
          <Switch
            checked={!!appSettings.showLinkedDocInSidebar}
            onChange={checked =>
              updateSettings('showLinkedDocInSidebar', checked)
            }
          />
        </SettingRow>
        <SidebarSectionsSetting />
      </SettingWrapper>

      {BUILD_CONFIG.isElectron ? <MenubarSetting /> : null}
    </>
  );
};
