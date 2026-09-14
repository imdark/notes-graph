import { ArrowRightBigIcon } from '@blocksuite/icons/rc';
import { useI18n } from '@notesgraph/i18n';

import * as styles from './share-footer.css';

export const ShareFooter = () => {
  const t = useI18n();
  return (
    <div className={styles.footerContainer}>
      <div className={styles.footer}>
        <div className={styles.description}>
          {t['com.notesgraph.share-page.footer.description']()}
        </div>
        <a
          className={styles.getStartLink}
          href="https://notesgraph.com/"
          target="_blank"
          rel="noreferrer"
        >
          {t['com.notesgraph.share-page.footer.get-started']()}
          <ArrowRightBigIcon fontSize={16} />
        </a>
      </div>
    </div>
  );
};
