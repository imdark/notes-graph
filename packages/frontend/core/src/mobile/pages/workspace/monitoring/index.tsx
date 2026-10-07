import { ComputerPanelIcon } from '@blocksuite/icons/rc';
import { useThemeColorV2 } from '@notesgraph/component';
import { MonitoringView } from '@notesgraph/core/components/monitoring';

import { PageHeader } from '../../../components';
import { Page } from '../../../components/page';
import * as styles from '../deployments/styles.css';

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');
  return (
    <Page
      header={
        <PageHeader className={styles.header} back>
          <div className={styles.headerContent}>
            <ComputerPanelIcon className={styles.headerIcon} />
            Monitoring
          </div>
        </PageHeader>
      }
    >
      <div className={styles.body}>
        <MonitoringView />
      </div>
    </Page>
  );
};
