import { Button } from '@notesgraph/component';
import { SettingRow } from '@notesgraph/component/setting-components';
import { getUpgradeQuestionnaireLink } from '@notesgraph/core/components/hooks/notesgraph/use-subscription-notify';
import {
  AuthService,
  WorkspaceSubscriptionService,
} from '@notesgraph/core/modules/cloud';
import { SubscriptionPlan, SubscriptionRecurring } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

import * as styles from './styles.css';

export const TypeformLink = () => {
  const t = useI18n();
  const workspaceSubscriptionService = useService(WorkspaceSubscriptionService);
  const authService = useService(AuthService);

  const workspaceSubscription = useLiveData(
    workspaceSubscriptionService.subscription.subscription$
  );
  const account = useLiveData(authService.session.account$);

  if (!account) return null;

  const link = getUpgradeQuestionnaireLink({
    name: account.info?.name,
    id: account.id,
    email: account.email,
    recurring: workspaceSubscription?.recurring ?? SubscriptionRecurring.Yearly,
    plan: SubscriptionPlan.Team,
  });

  return (
    <SettingRow
      className={styles.paymentMethod}
      name={t['com.notesgraph.payment.billing-type-form.title']()}
      desc={t['com.notesgraph.payment.billing-type-form.description']()}
    >
      <a target="_blank" href={link} rel="noreferrer">
        <Button>{t['com.notesgraph.payment.billing-type-form.go']()}</Button>
      </a>
    </SettingRow>
  );
};
