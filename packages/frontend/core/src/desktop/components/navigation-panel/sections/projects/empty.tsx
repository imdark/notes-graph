import { FolderIcon } from '@blocksuite/icons/rc';
import { useI18n } from '@notesgraph/i18n';

import { NavigationPanelEmptySection } from '../../layouts/empty-section';

export const RootEmpty = () => {
  const t = useI18n();

  return (
    <NavigationPanelEmptySection
      icon={FolderIcon}
      message={t['com.notesgraph.rootAppSidebar.projects.empty']()}
      messageTestId="slider-bar-projects-empty-message"
    />
  );
};
