import { MonitoringView } from '@notesgraph/core/components/monitoring';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
} from '@notesgraph/core/modules/workbench';

import * as styles from '../agents/agents-page.css';

export const Component = () => {
  return (
    <>
      <ViewTitle title="Monitoring" />
      <ViewIcon icon="monitoring" />
      <ViewBody>
        <div className={styles.body}>
          <MonitoringView />
        </div>
      </ViewBody>
    </>
  );
};
