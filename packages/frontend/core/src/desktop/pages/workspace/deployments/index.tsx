import { DeploymentsView } from '@notesgraph/core/components/deployments';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
} from '@notesgraph/core/modules/workbench';

import * as styles from '../agents/agents-page.css';

export const Component = () => {
  return (
    <>
      <ViewTitle title="Deployments" />
      <ViewIcon icon="deploy" />
      <ViewBody>
        <div className={styles.body}>
          <DeploymentsView />
        </div>
      </ViewBody>
    </>
  );
};
