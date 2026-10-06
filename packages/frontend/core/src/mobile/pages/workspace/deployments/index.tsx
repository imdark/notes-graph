import { PublishIcon } from '@blocksuite/icons/rc';
import { useThemeColorV2 } from '@notesgraph/component';
import { DeploymentsView } from '@notesgraph/core/components/deployments';

import { PageHeader } from '../../../components';
import { Page } from '../../../components/page';
import * as styles from './styles.css';

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');
  return (
    <Page
      header={
        <PageHeader className={styles.header} back>
          <div className={styles.headerContent}>
            <PublishIcon className={styles.headerIcon} />
            Deployments
          </div>
        </PageHeader>
      }
    >
      <div className={styles.body}>
        <DeploymentsView />
      </div>
    </Page>
  );
};
