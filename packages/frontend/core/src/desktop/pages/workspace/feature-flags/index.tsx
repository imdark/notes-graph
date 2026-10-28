import { FeatureFlagsView } from '@notesgraph/core/components/feature-flags';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
} from '@notesgraph/core/modules/workbench';

import * as styles from '../agents/agents-page.css';

export const Component = () => {
  return (
    <>
      <ViewTitle title="Feature flags" />
      <ViewIcon icon="deploy" />
      <ViewBody>
        <div className={styles.body}>
          <FeatureFlagsView />
        </div>
      </ViewBody>
    </>
  );
};
