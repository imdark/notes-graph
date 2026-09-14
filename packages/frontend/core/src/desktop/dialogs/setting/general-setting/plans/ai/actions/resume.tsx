import { SingleSelectCheckSolidIcon } from '@blocksuite/icons/rc';
import {
  Button,
  type ButtonProps,
  notify,
  useConfirmModal,
} from '@notesgraph/component';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { SubscriptionService } from '@notesgraph/core/modules/cloud';
import { SubscriptionPlan } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { cssVar } from '@toeverything/theme';
import { nanoid } from 'nanoid';
import { useState } from 'react';

export const AIResume = (btnProps: ButtonProps) => {
  const t = useI18n();
  const [idempotencyKey, setIdempotencyKey] = useState(nanoid());
  const subscription = useService(SubscriptionService).subscription;

  const [isMutating, setIsMutating] = useState(false);

  const { openConfirmModal } = useConfirmModal();

  const resume = useAsyncCallback(async () => {
    const aiSubscription = subscription.ai$.value;
    if (aiSubscription) {
      track.$.settingsPanel.plans.resumeSubscription({
        plan: SubscriptionPlan.AI,
        recurring: aiSubscription.recurring,
      });
    }

    openConfirmModal({
      title: t['com.notesgraph.payment.ai.action.resume.confirm.title'](),
      description:
        t['com.notesgraph.payment.ai.action.resume.confirm.description'](),
      confirmText:
        t['com.notesgraph.payment.ai.action.resume.confirm.confirm-text'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      cancelText:
        t['com.notesgraph.payment.ai.action.resume.confirm.cancel-text'](),
      onConfirm: async () => {
        setIsMutating(true);
        await subscription.resumeSubscription(
          idempotencyKey,
          SubscriptionPlan.AI
        );
        if (aiSubscription) {
          track.$.settingsPanel.plans.confirmResumingSubscription({
            plan: aiSubscription.plan,
            recurring: aiSubscription.recurring,
          });
        }
        notify({
          icon: <SingleSelectCheckSolidIcon />,
          iconColor: cssVar('processingColor'),
          title:
            t['com.notesgraph.payment.ai.action.resume.confirm.notify.title'](),
          message:
            t['com.notesgraph.payment.ai.action.resume.confirm.notify.msg'](),
        });
        setIdempotencyKey(nanoid());
      },
    });
  }, [subscription, openConfirmModal, t, idempotencyKey]);

  return (
    <Button
      loading={isMutating}
      onClick={resume}
      variant="primary"
      {...btnProps}
    >
      {t['com.notesgraph.payment.ai.action.resume.button-label']()}
    </Button>
  );
};
