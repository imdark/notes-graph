import { Button } from '@notesgraph/component';
import { AuthPageContainer } from '@notesgraph/component/auth-components';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { GraphQLService } from '@notesgraph/core/modules/cloud';
import { UserFriendlyError } from '@notesgraph/error';
import { verifyEmailMutation } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { type FC, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AppContainer } from '../../components/app-container';

export const ConfirmVerifiedEmail: FC<{
  onOpenNotesGraph: () => void;
}> = ({ onOpenNotesGraph }) => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const [isLoading, setIsLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const navigateHelper = useNavigateHelper();

  useEffect(() => {
    (async () => {
      const token = searchParams.get('token') ?? '';
      setIsLoading(true);
      await graphqlService
        .gql({
          query: verifyEmailMutation,
          variables: {
            token: token,
          },
        })
        .catch(error => {
          const userFriendlyError = UserFriendlyError.fromAny(error);
          if (userFriendlyError.is('INVALID_EMAIL_TOKEN')) {
            return navigateHelper.jumpToExpired();
          }
          throw error;
        });
    })().catch(err => {
      // TODO(@eyhn): Add error handling
      console.error(err);
    });
  }, [graphqlService, navigateHelper, searchParams]);

  if (isLoading) {
    return <AppContainer fallback />;
  }

  return (
    <AuthPageContainer
      title={t['com.notesgraph.auth.change.email.page.success.title']()}
      subtitle={t['com.notesgraph.auth.change.email.page.success.subtitle']()}
    >
      <Button variant="primary" size="large" onClick={onOpenNotesGraph}>
        {t['com.notesgraph.auth.open.notesgraph']()}
      </Button>
    </AuthPageContainer>
  );
};
