import { Button } from '@notesgraph/component';
import { AuthPageContainer } from '@notesgraph/component/auth-components';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { Trans, useI18n } from '@notesgraph/i18n';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import * as styles from './styles.css';

/**
 * /ai-upgrade-success page
 *
 * only on web
 */
export const Component = () => {
  const t = useI18n();
  const [params] = useSearchParams();

  const { jumpToIndex, jumpToOpenInApp } = useNavigateHelper();
  const openNotesGraph = useCallback(() => {
    if (params.get('client')) {
      return jumpToOpenInApp('bring-to-front');
    } else {
      jumpToIndex();
    }
  }, [jumpToIndex, jumpToOpenInApp, params]);

  const subtitle = (
    <div className={styles.leftContentText}>
      {t['com.notesgraph.payment.ai-upgrade-success-page.text']()}
      <div>
        <Trans
          i18nKey={'com.notesgraph.payment.upgrade-success-page.support'}
          components={{
            1: (
              <a href="mailto:support@notesgraph.com" className={styles.mail} />
            ),
          }}
        />
      </div>
    </div>
  );

  return (
    <AuthPageContainer
      title={t['com.notesgraph.payment.ai-upgrade-success-page.title']()}
      subtitle={subtitle}
    >
      <Button variant="primary" size="extraLarge" onClick={openNotesGraph}>
        {t['com.notesgraph.other-page.nav.open-notesgraph']()}
      </Button>
    </AuthPageContainer>
  );
};
