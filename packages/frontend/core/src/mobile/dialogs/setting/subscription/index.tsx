import { Button } from '@notesgraph/component';
import { AuthService, ServerService } from '@notesgraph/core/modules/cloud';
import { NativePaywallService } from '@notesgraph/core/modules/paywall';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

import * as styles from './styles.css';

export const UserSubscription = () => {
  const serverService = useService(ServerService);
  const authService = useService(AuthService);
  const nativePaywallProvider =
    useService(NativePaywallService).getNativePaywallProvider();
  const t = useI18n();

  const supported = useLiveData(
    serverService.server.features$.map(f => f.payment)
  );

  const loggedIn = useLiveData(authService.session.status$) === 'authenticated';

  if (!loggedIn) {
    return null;
  }

  if (!supported) {
    // TODO: enable this
    // return null;
  }

  if (!nativePaywallProvider) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <div className={styles.title}>
          {t['com.notesgraph.payment.subscription.title']()}
        </div>
        <div className={styles.description}>
          {t['com.notesgraph.payment.subscription.description']()}
        </div>
      </div>
      <Button
        className={styles.button}
        variant="primary"
        onClick={() =>
          void nativePaywallProvider.showPaywall('Pro').catch(console.error)
        }
      >
        {t['com.notesgraph.payment.subscription.button']()}
      </Button>
    </div>
  );
};
