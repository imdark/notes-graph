import { ArrowRightSmallIcon, OpenInNewIcon } from '@blocksuite/icons/rc';
import { Switch } from '@notesgraph/component';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { useAppUpdater } from '@notesgraph/core/components/hooks/use-app-updater';
import { UrlService } from '@notesgraph/core/modules/url';
import { appNames } from '@notesgraph/core/utils/channel';
import { useI18n } from '@notesgraph/i18n';
import { useServices } from '@notesgraph/infra';
import { useCallback } from 'react';

import { useAppSettingHelper } from '../../../../../components/hooks/notesgraph/use-app-setting-helper';
import { relatedLinks } from './config';
import * as styles from './style.css';
import { UpdateCheckSection } from './update-check-section';

export const AboutNotesGraph = () => {
  const t = useI18n();
  const { appSettings, updateSettings } = useAppSettingHelper();
  const { toggleAutoCheck, toggleAutoDownload } = useAppUpdater();
  const channel = BUILD_CONFIG.appBuildType;
  const appName = appNames[channel];
  const { urlService } = useServices({
    UrlService,
  });

  const onSwitchAutoCheck = useCallback(
    (checked: boolean) => {
      toggleAutoCheck(checked);
      updateSettings('autoCheckUpdate', checked);
    },
    [toggleAutoCheck, updateSettings]
  );

  const onSwitchAutoDownload = useCallback(
    (checked: boolean) => {
      toggleAutoDownload(checked);
      updateSettings('autoDownloadUpdate', checked);
    },
    [toggleAutoDownload, updateSettings]
  );

  const onSwitchTelemetry = useCallback(
    (checked: boolean) => {
      updateSettings('enableTelemetry', checked);
    },
    [updateSettings]
  );

  return (
    <>
      <SettingHeader
        title={t['com.notesgraph.aboutNotesGraph.title']()}
        subtitle={t['com.notesgraph.aboutNotesGraph.subtitle']()}
        data-testid="about-title"
      />
      <SettingWrapper
        title={t['com.notesgraph.aboutNotesGraph.version.title']()}
      >
        <SettingRow
          name={appName}
          desc={BUILD_CONFIG.appVersion}
          className={styles.appImageRow}
        >
          <NotesGraphLogoIcon width={56} height={56} />
        </SettingRow>
        <SettingRow
          name={t['com.notesgraph.aboutNotesGraph.version.editor.title']()}
          desc={BUILD_CONFIG.editorVersion}
        />
        {BUILD_CONFIG.isElectron ? (
          <>
            <UpdateCheckSection />
            <SettingRow
              name={t['com.notesgraph.aboutNotesGraph.autoCheckUpdate.title']()}
              desc={t[
                'com.notesgraph.aboutNotesGraph.autoCheckUpdate.description'
              ]()}
            >
              <Switch
                checked={appSettings.autoCheckUpdate}
                onChange={onSwitchAutoCheck}
              />
            </SettingRow>
            <SettingRow
              name={t[
                'com.notesgraph.aboutNotesGraph.autoDownloadUpdate.title'
              ]()}
              desc={t[
                'com.notesgraph.aboutNotesGraph.autoDownloadUpdate.description'
              ]()}
            >
              <Switch
                checked={appSettings.autoDownloadUpdate}
                onChange={onSwitchAutoDownload}
              />
            </SettingRow>
            <SettingRow
              name={t['com.notesgraph.aboutNotesGraph.changelog.title']()}
              desc={t['com.notesgraph.aboutNotesGraph.changelog.description']()}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                urlService.openPopupWindow(BUILD_CONFIG.changelogUrl);
              }}
            >
              <ArrowRightSmallIcon />
            </SettingRow>
          </>
        ) : null}
        <SettingRow
          name={t['com.notesgraph.telemetry.enable']()}
          desc={t['com.notesgraph.telemetry.enable.desc']()}
        >
          <Switch
            checked={appSettings.enableTelemetry !== false}
            onChange={onSwitchTelemetry}
          />
        </SettingRow>
      </SettingWrapper>
      <SettingWrapper
        title={t['com.notesgraph.aboutNotesGraph.contact.title']()}
      >
        <a
          className={styles.link}
          rel="noreferrer"
          href="https://notesgraph.com"
          target="_blank"
        >
          {t['com.notesgraph.aboutNotesGraph.contact.website']()}
          <OpenInNewIcon className="icon" />
        </a>
        <a
          className={styles.link}
          rel="noreferrer"
          href="https://notesgraph.com/redirect/discord"
          target="_blank"
        >
          {t['com.notesgraph.aboutNotesGraph.contact.community']()}
          <OpenInNewIcon className="icon" />
        </a>
      </SettingWrapper>
      <SettingWrapper
        title={t['com.notesgraph.aboutNotesGraph.community.title']()}
      >
        <div className={styles.communityWrapper}>
          {relatedLinks.map(({ icon, title, link }) => {
            return (
              <div
                className={styles.communityItem}
                onClick={() => {
                  urlService.openPopupWindow(link);
                }}
                key={title}
              >
                {icon}
                <p>{title}</p>
              </div>
            );
          })}
        </div>
      </SettingWrapper>
      <SettingWrapper title={t['com.notesgraph.aboutNotesGraph.legal.title']()}>
        <a
          className={styles.link}
          rel="noreferrer"
          href="https://notesgraph.com/privacy"
          target="_blank"
        >
          {t['com.notesgraph.aboutNotesGraph.legal.privacy']()}
          <OpenInNewIcon className="icon" />
        </a>
        <a
          className={styles.link}
          rel="noreferrer"
          href="https://notesgraph.com/terms"
          target="_blank"
        >
          {t['com.notesgraph.aboutNotesGraph.legal.tos']()}
          <OpenInNewIcon className="icon" />
        </a>
      </SettingWrapper>
    </>
  );
};
