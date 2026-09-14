import { WorkbenchLink } from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import track from '@notesgraph/track';

import * as styles from './navigation.css';

const items = [
  {
    value: 'docs',
    label: 'com.notesgraph.docs.header',
    testId: 'workspace-docs-button',
    to: '/all',
  },
  {
    value: 'collections',
    label: 'com.notesgraph.collections.header',
    testId: 'workspace-collections-button',
    to: '/collection',
  },
  {
    value: 'tags',
    label: 'Tags',
    testId: 'workspace-tags-button',
    to: '/tag',
  },
] as const;

type NavigationKey = (typeof items)[number]['value'];

export const ExplorerNavigation = ({ active }: { active: NavigationKey }) => {
  const t = useI18n();

  return (
    <div className={styles.container}>
      {items.map(item => (
        <WorkbenchLink
          key={item.value}
          data-testid={item.testId}
          data-active={active === item.value}
          to={item.to}
          onClick={() => {
            track.allDocs.header.navigation.navigateAllDocsRouter({
              control: item.value,
            });
          }}
          className={styles.item}
        >
          {t[item.label]()}
        </WorkbenchLink>
      ))}
    </div>
  );
};
