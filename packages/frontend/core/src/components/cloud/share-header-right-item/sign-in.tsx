import { Button } from '@notesgraph/component/ui/button';
import { GlobalDialogService } from '@notesgraph/core/modules/dialogs';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import * as styles from './styles.css';

export const SignIn = () => {
  const globalDialogService = useService(GlobalDialogService);

  const t = useI18n();

  const onClickSignIn = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <Button
      className={styles.editButton}
      onClick={onClickSignIn}
      data-testid="share-page-sign-in-button"
    >
      {t['com.notesgraph.share-page.header.login']()}
    </Button>
  );
};
