import type { PasswordLimitsFragment } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import type { FC } from 'react';
import { useCallback, useState } from 'react';

import { Button } from '../../ui/button';
import { notify } from '../../ui/notification';
import { AuthPageContainer } from './auth-page-container';
import { SetPassword } from './set-password';

export const ChangePasswordPage: FC<{
  passwordLimits: PasswordLimitsFragment;
  onSetPassword: (password: string) => Promise<void>;
  onOpenNotesGraph: () => void;
}> = ({
  passwordLimits,
  onSetPassword: propsOnSetPassword,
  onOpenNotesGraph,
}) => {
  const t = useI18n();
  const [hasSetUp, setHasSetUp] = useState(false);

  const onSetPassword = useCallback(
    (passWord: string) => {
      propsOnSetPassword(passWord)
        .then(() => setHasSetUp(true))
        .catch(e =>
          notify.error({
            title: t['com.notesgraph.auth.password.set-failed'](),
            message: String(e),
          })
        );
    },
    [propsOnSetPassword, t]
  );

  return (
    <AuthPageContainer
      title={
        hasSetUp
          ? t['com.notesgraph.auth.reset.password.page.success']()
          : t['com.notesgraph.auth.reset.password.page.title']()
      }
      subtitle={
        hasSetUp
          ? t['com.notesgraph.auth.sent.reset.password.success.message']()
          : t['com.notesgraph.auth.page.sent.email.subtitle']({
              min: String(passwordLimits.minLength),
              max: String(passwordLimits.maxLength),
            })
      }
    >
      {hasSetUp ? (
        <Button variant="primary" size="large" onClick={onOpenNotesGraph}>
          {t['com.notesgraph.auth.open.notesgraph']()}
        </Button>
      ) : (
        <SetPassword
          passwordLimits={passwordLimits}
          onSetPassword={onSetPassword}
        />
      )}
    </AuthPageContainer>
  );
};
