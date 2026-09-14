import { useI18n } from '@notesgraph/i18n';
import type { FC } from 'react';

import { Button } from '../../ui/button';
import { AuthPageContainer } from './auth-page-container';

export const SignInSuccessPage: FC<{
  onOpenNotesGraph: () => void;
}> = ({ onOpenNotesGraph }) => {
  const t = useI18n();
  return (
    <AuthPageContainer
      title={t['com.notesgraph.auth.signed.success.title']()}
      subtitle={t['com.notesgraph.auth.signed.success.subtitle']()}
    >
      <Button variant="primary" size="large" onClick={onOpenNotesGraph}>
        {t['com.notesgraph.auth.open.notesgraph']()}
      </Button>
    </AuthPageContainer>
  );
};
