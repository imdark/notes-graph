import { AutomationsView } from '@notesgraph/core/components/automations';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
} from '@notesgraph/core/modules/workbench';

import * as styles from '../agents/agents-page.css';

export const Component = () => {
  return (
    <>
      <ViewTitle title="Automations" />
      <ViewIcon icon="automations" />
      <ViewBody>
        <div className={styles.body}>
          <AutomationsView />
        </div>
      </ViewBody>
    </>
  );
};
