import {
  Button,
  type ButtonProps,
  useConfirmModal,
} from '@notesgraph/component';
import { getDowngradeQuestionnaireLink } from '@notesgraph/core/components/hooks/notesgraph/use-subscription-notify';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { useDowngradeNotify } from '@notesgraph/core/components/notesgraph/subscription-landing/notify';
import {
  AuthService,
  SubscriptionService,
} from '@notesgraph/core/modules/cloud';
import { SubscriptionPlan } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { nanoid } from 'nanoid';
import { useState } from 'react';

export const AICancel = (btnProps: ButtonProps) => {
  const t = useI18n();
  const [isMutating, setMutating] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(nanoid());
  const subscription = useService(SubscriptionService).subscription;
  const authService = useService(AuthService);

  const { openConfirmModal } = useConfirmModal();
  const downgradeNotify = useDowngradeNotify();

  const cancel = useAsyncCallback(async () => {
    const aiSubscription = subscription.ai$.value;
    if (aiSubscription) {
      track.$.settingsPanel.plans.cancelSubscription({
        plan: SubscriptionPlan.AI,
        recurring: aiSubscription.recurring,
      });
    }
    openConfirmModal({
      title: t['com.notesgraph.payment.ai.action.cancel.confirm.title'](),
      description:
        t['com.notesgraph.payment.ai.action.cancel.confirm.description'](),
      reverseFooter: true,
      confirmText:
        t['com.notesgraph.payment.ai.action.cancel.confirm.confirm-text'](),
      confirmButtonOptions: {
        variant: 'secondary',
      },
      cancelText:
        t['com.notesgraph.payment.ai.action.cancel.confirm.cancel-text'](),
      cancelButtonOptions: {
        variant: 'primary',
      },
      onConfirm: async () => {
        try {
          setMutating(true);
          await subscription.cancelSubscription(
            idempotencyKey,
            SubscriptionPlan.AI
          );
          setIdempotencyKey(nanoid());
          track.$.settingsPanel.plans.confirmCancelingSubscription({
            plan: SubscriptionPlan.AI,
            recurring: aiSubscription?.recurring,
          });
          const account = authService.session.account$.value;
          const prevRecurring = subscription.ai$.value?.recurring;
          if (account && prevRecurring) {
            downgradeNotify(
              getDowngradeQuestionnaireLink({
                email: account.email,
                name: account.info?.name,
                id: account.id,
                plan: SubscriptionPlan.AI,
                recurring: prevRecurring,
              })
            );
          }
        } finally {
          setMutating(false);
        }
      },
    });
  }, [
    subscription,
    openConfirmModal,
    t,
    idempotencyKey,
    authService.session.account$.value,
    downgradeNotify,
  ]);

  return (
    <Button
      onClick={cancel}
      loading={isMutating}
      variant="secondary"
      {...btnProps}
    >
      {t['com.notesgraph.payment.ai.action.cancel.button-label']()}
    </Button>
  );
};
