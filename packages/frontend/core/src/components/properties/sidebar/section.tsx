import { ToggleRightIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';
import { Trigger as CollapsibleTrigger } from '@radix-ui/react-collapsible';

import * as styles from './section.css';

export const WorkspacePropertyListSidebarSection = () => {
  const t = useI18n();
  return (
    <div className={styles.headerRoot}>
      <span className={styles.headerTitle}>
        {t['com.notesgraph.propertySidebar.property-list.section']()}
      </span>
      <CollapsibleTrigger asChild>
        <IconButton>
          <ToggleRightIcon className={styles.collapseIcon} />
        </IconButton>
      </CollapsibleTrigger>
    </div>
  );
};

export const AddWorkspacePropertySidebarSection = () => {
  const t = useI18n();
  return (
    <div className={styles.headerRoot}>
      <span className={styles.headerTitle}>
        {t['com.notesgraph.propertySidebar.add-more.section']()}
      </span>
      <CollapsibleTrigger asChild>
        <IconButton>
          <ToggleRightIcon className={styles.collapseIcon} />
        </IconButton>
      </CollapsibleTrigger>
    </div>
  );
};
