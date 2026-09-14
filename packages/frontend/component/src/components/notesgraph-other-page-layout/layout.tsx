import { Button } from '@notesgraph/component/ui/button';
import { useI18n } from '@notesgraph/i18n';
import { useTheme } from 'next-themes';
import { type ReactNode, useCallback } from 'react';

import { NotesGraphLogoIcon } from '../brand';
import dotBgDark from './assets/dot-bg.dark.png';
import dotBgLight from './assets/dot-bg.light.png';
import { DesktopNavbar } from './desktop-navbar';
import * as styles from './index.css';
import { MobileNavbar } from './mobile-navbar';

export const NotesGraphOtherPageLayout = ({
  children,
}: {
  children: ReactNode;
}) => {
  const t = useI18n();

  const openDownloadLink = useCallback(() => {
    open(BUILD_CONFIG.downloadUrl, '_blank');
  }, []);

  const { resolvedTheme } = useTheme();
  const backgroundImage =
    resolvedTheme === 'dark' && dotBgDark ? dotBgDark : dotBgLight;

  return (
    <div
      className={styles.root}
      style={{ backgroundImage: `url(${backgroundImage})` }}
    >
      {BUILD_CONFIG.isElectron ? (
        <div className={styles.draggableHeader} />
      ) : (
        <div className={styles.topNav}>
          <a href="/" rel="noreferrer" className={styles.notesgraphLogo}>
            <NotesGraphLogoIcon width={24} height={24} />
          </a>

          <DesktopNavbar />
          <Button
            onClick={openDownloadLink}
            className={styles.hideInSmallScreen}
          >
            {t['com.notesgraph.auth.open.notesgraph.download-app']()}
          </Button>
          <MobileNavbar />
        </div>
      )}

      {children}
    </div>
  );
};
