import { useThemeColorV2 } from '@notesgraph/component';
import { FeatureFlagsView } from '@notesgraph/core/components/feature-flags';

import { PageHeader } from '../../../components';
import { Page } from '../../../components/page';
import * as styles from '../deployments/styles.css';

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');
  return (
    <Page
      header={
        <PageHeader className={styles.header} back>
          <div className={styles.headerContent}>Feature flags</div>
        </PageHeader>
      }
    >
      <div className={styles.body}>
        <FeatureFlagsView />
      </div>
    </Page>
  );
};
