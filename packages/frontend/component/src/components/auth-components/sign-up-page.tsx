import type { PasswordLimitsFragment } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import type { FC } from 'react';
import { useCallback, useState } from 'react';

import { Button } from '../../ui/button';
import { notify } from '../../ui/notification';
import { AuthPageContainer } from './auth-page-container';
import { SetPassword } from './set-password';

export const SignUpPage: FC<{
  passwordLimits: PasswordLimitsFragment;
  user: { email?: string };
  onSetPassword: (password: string) => Promise<void>;
  openButtonText?: string;
  onOpenNotesGraph: () => void;
}> = ({
  passwordLimits,
  user: { email },
  onSetPassword: propsOnSetPassword,
  onOpenNotesGraph,
  openButtonText,
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
  const onLater = useCallback(() => {
    setHasSetUp(true);
  }, []);

  return (
    <AuthPageContainer
      title={
        hasSetUp
          ? t['com.notesgraph.auth.sign.up.success.title']()
          : t['com.notesgraph.auth.page.sent.email.title']()
      }
      subtitle={
        hasSetUp ? (
          t['com.notesgraph.auth.sign.up.success.subtitle']()
        ) : (
          <>
            {t['com.notesgraph.auth.page.sent.email.subtitle']({
              min: String(passwordLimits.minLength),
              max: String(passwordLimits.maxLength),
            })}
            <a href={`mailto:${email}`}>{email}</a>
          </>
        )
      }
    >
      {hasSetUp ? (
        <Button variant="primary" size="large" onClick={onOpenNotesGraph}>
          {openButtonText ?? t['com.notesgraph.auth.open.notesgraph']()}
        </Button>
      ) : (
        <SetPassword
          passwordLimits={passwordLimits}
          onSetPassword={onSetPassword}
          onLater={onLater}
          showLater={true}
        />
      )}
    </AuthPageContainer>
  );
};
