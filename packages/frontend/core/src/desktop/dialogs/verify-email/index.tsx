import { Button, Modal, notify } from '@notesgraph/component';
import {
  AuthContent,
  AuthHeader,
  AuthInput,
} from '@notesgraph/component/auth-components';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import {
  AuthService,
  DefaultServerService,
  ServersService,
} from '@notesgraph/core/modules/cloud';
import type {
  DialogComponentProps,
  GLOBAL_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { Unreachable } from '@notesgraph/env/constant';
import {
  sendChangeEmailMutation,
  sendVerifyEmailMutation,
} from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useState } from 'react';

export const VerifyEmailDialog = ({
  close,
  server: serverBaseUrl,
  changeEmail,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['verify-email']>) => {
  const t = useI18n();
  const defaultServerService = useService(DefaultServerService);
  const serversService = useService(ServersService);
  let server;

  if (serverBaseUrl) {
    server = serversService.getServerByBaseUrl(serverBaseUrl);
    if (!server) {
      throw new Unreachable('Server not found');
    }
  } else {
    server = defaultServerService.server;
  }

  const authService = server.scope.get(AuthService);
  const account = useLiveData(authService.session.account$);
  const email = account?.email;
  const [hasSentEmail, setHasSentEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const passwordLimits = useLiveData(
    server.credentialsRequirement$.map(r => r?.password)
  );
  const serverName = useLiveData(server.config$.selector(c => c.serverName));

  if (!email) {
    // should not happen
    throw new Unreachable();
  }

  const onSendEmail = useAsyncCallback(async () => {
    setLoading(true);
    try {
      if (changeEmail) {
        await server.gql({
          query: sendChangeEmailMutation,
          variables: {
            callbackUrl: `/auth/changeEmail`,
          },
        });
      } else {
        await server.gql({
          query: sendVerifyEmailMutation,
          variables: {
            callbackUrl: `/auth/verify-email`,
          },
        });
      }

      notify.success({
        title: t['com.notesgraph.auth.send.verify.email.hint'](),
      });
      setHasSentEmail(true);
    } catch (err) {
      console.error(err);
      notify.error({
        title: t['com.notesgraph.auth.sent.change.email.fail'](),
      });
    } finally {
      setLoading(false);
    }
  }, [changeEmail, server, t]);

  if (!passwordLimits) {
    // should never reach here
    return null;
  }

  return (
    <Modal
      open
      onOpenChange={() => close()}
      width={400}
      minHeight={500}
      contentOptions={{
        ['data-testid' as string]: 'verify-email-modal',
        style: { padding: '44px 40px 20px' },
      }}
    >
      <AuthHeader
        title={serverName}
        subTitle={
          changeEmail
            ? t['com.notesgraph.settings.email.action.change']()
            : t['com.notesgraph.settings.email.action.verify']()
        }
      />
      <AuthContent>
        <p>
          {changeEmail
            ? t['com.notesgraph.auth.change.email.message']({ email })
            : t['com.notesgraph.auth.verify.email.message']({ email })}
        </p>
        <AuthInput
          label={t['com.notesgraph.settings.email']()}
          disabled={true}
          value={email}
        />
        <Button
          variant="primary"
          size="extraLarge"
          style={{ width: '100%' }}
          disabled={hasSentEmail}
          loading={loading}
          onClick={onSendEmail}
        >
          {hasSentEmail
            ? t['com.notesgraph.auth.sent']()
            : t['com.notesgraph.auth.send.verify.email.hint']()}
        </Button>
      </AuthContent>
    </Modal>
  );
};
