import { SecretsView } from '@notesgraph/core/components/secrets';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
} from '@notesgraph/core/modules/workbench';

import * as styles from '../agents/agents-page.css';

export const Component = () => {
  return (
    <>
      <ViewTitle title="Secrets" />
      <ViewIcon icon="secrets" />
      <ViewBody>
        <div className={styles.body}>
          <SecretsView />
        </div>
      </ViewBody>
    </>
  );
};
