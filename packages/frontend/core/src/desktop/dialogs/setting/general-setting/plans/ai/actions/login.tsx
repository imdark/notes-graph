import { Button, type ButtonProps } from '@notesgraph/component';
import { GlobalDialogService } from '@notesgraph/core/modules/dialogs';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

export const AILogin = (btnProps: ButtonProps) => {
  const t = useI18n();
  const globalDialogService = useService(GlobalDialogService);

  const onClickSignIn = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <Button onClick={onClickSignIn} variant="primary" {...btnProps}>
      {t['com.notesgraph.payment.ai.action.login.button-label']()}
    </Button>
  );
};
