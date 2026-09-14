import { LocalWorkspaceIcon } from '@blocksuite/icons/rc';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import { Button } from '@notesgraph/component/ui/button';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { appIconMap, appNames } from '@notesgraph/core/utils/channel';
import { Trans, useI18n } from '@notesgraph/i18n';
import { useServiceOptional } from '@notesgraph/infra';
import type { MouseEvent } from 'react';
import { useCallback } from 'react';

import { getOpenUrlInDesktopAppLink } from '../utils';
import * as styles from './open-in-app-page.css';

let lastOpened = '';

interface OpenAppProps {
  urlToOpen?: string | null;
  openHereClicked?: (e: MouseEvent) => void;
  mode?: 'auth' | 'open-doc'; // default to 'auth'
}
const channel = BUILD_CONFIG.appBuildType;
const url =
  'https://notesgraph.com/download' +
  (channel !== 'stable' ? '/beta-canary' : '');

export const OpenInAppPage = ({
  urlToOpen,
  openHereClicked,
  mode = 'auth',
}: OpenAppProps) => {
  // default to open the current page in desktop app
  urlToOpen ??= getOpenUrlInDesktopAppLink(window.location.href, true);
  const workspaceDialogService = useServiceOptional(WorkspaceDialogService);
  const t = useI18n();

  const openDownloadLink = useCallback(() => {
    open(url, '_blank');
  }, []);

  const appIcon = appIconMap[channel];
  const appName = appNames[channel];

  const goToAppearanceSetting = useCallback(
    (e: MouseEvent) => {
      openHereClicked?.(e);
      workspaceDialogService?.open('setting', {
        activeTab: 'appearance',
      });
    },
    [workspaceDialogService, openHereClicked]
  );

  if (urlToOpen && lastOpened !== urlToOpen) {
    lastOpened = urlToOpen;
    location.href = urlToOpen;
  }

  if (!urlToOpen) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.topNav}>
        <a href="/" rel="noreferrer" className={styles.notesgraphLogo}>
          <NotesGraphLogoIcon width={24} height={24} />
        </a>

        <div className={styles.topNavLinks}>
          <a
            href="https://notesgraph.com"
            target="_blank"
            rel="noreferrer"
            className={styles.topNavLink}
          >
            Official Website
          </a>
          <a
            href="https://notesgraph.com/blog"
            target="_blank"
            rel="noreferrer"
            className={styles.topNavLink}
          >
            Blog
          </a>
          <a
            href="https://notesgraph.com/about-us"
            target="_blank"
            rel="noreferrer"
            className={styles.topNavLink}
          >
            Contact us
          </a>
        </div>

        <Button onClick={openDownloadLink}>
          {t['com.notesgraph.auth.open.notesgraph.download-app']()}
        </Button>
      </div>

      <div className={styles.centerContent}>
        <img src={appIcon} alt={appName} width={120} height={120} />

        <div className={styles.prompt}>
          {mode === 'open-doc' ? (
            <Trans i18nKey="com.notesgraph.auth.open.notesgraph.open-doc-prompt">
              This doc is now opened in {appName}
            </Trans>
          ) : (
            <Trans i18nKey="com.notesgraph.auth.open.notesgraph.commpt">
              Open {appName} app now
            </Trans>
          )}
        </div>

        <div className={styles.promptLinks}>
          {openHereClicked && (
            <a
              className={styles.promptLink}
              onClick={openHereClicked}
              target="_blank"
              rel="noreferrer"
            >
              {t['com.notesgraph.auth.open.notesgraph.doc.open-here']()}
            </a>
          )}
          <a
            className={styles.promptLink}
            href={urlToOpen}
            target="_blank"
            rel="noreferrer"
          >
            {t['com.notesgraph.auth.open.notesgraph.try-again']()}
          </a>
        </div>
      </div>

      {mode === 'open-doc' ? (
        <div className={styles.docFooter}>
          <button
            className={styles.editSettingsLink}
            onClick={goToAppearanceSetting}
          >
            {t['com.notesgraph.auth.open.notesgraph.doc.edit-settings']()}
          </button>

          <div className={styles.docFooterText}>
            <LocalWorkspaceIcon width={16} height={16} />
            {t['com.notesgraph.auth.open.notesgraph.doc.footer-text']()}
          </div>
        </div>
      ) : null}
    </div>
  );
};
