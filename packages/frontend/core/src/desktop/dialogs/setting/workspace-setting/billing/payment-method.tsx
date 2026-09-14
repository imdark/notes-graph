import { Button, notify } from '@notesgraph/component';
import { SettingRow } from '@notesgraph/component/setting-components';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { useMutation } from '@notesgraph/core/components/hooks/use-mutation';
import { UrlService } from '@notesgraph/core/modules/url';
import { UserFriendlyError } from '@notesgraph/error';
import { createCustomerPortalMutation } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';

import * as styles from './styles.css';

export const PaymentMethodUpdater = () => {
  const { isMutating, trigger } = useMutation({
    mutation: createCustomerPortalMutation,
  });
  const urlService = useService(UrlService);
  const t = useI18n();

  const update = useAsyncCallback(async () => {
    await trigger(null, {
      onSuccess: data => {
        urlService.openExternal(data.createCustomerPortal);
      },
    }).catch(e => {
      const userFriendlyError = UserFriendlyError.fromAny(e);
      notify.error(userFriendlyError);
    });
  }, [trigger, urlService]);

  return (
    <SettingRow
      className={styles.paymentMethod}
      name={t['com.notesgraph.payment.billing-setting.payment-method']()}
      desc={t[
        'com.notesgraph.payment.billing-setting.payment-method.description'
      ]()}
    >
      <Button onClick={update} loading={isMutating} disabled={isMutating}>
        {t['com.notesgraph.payment.billing-setting.payment-method.go']()}
      </Button>
    </SettingRow>
  );
};
