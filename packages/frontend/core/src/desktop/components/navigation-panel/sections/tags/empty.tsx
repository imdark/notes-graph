import { TagIcon } from '@blocksuite/icons/rc';
import { useI18n } from '@notesgraph/i18n';

import { NavigationPanelEmptySection } from '../../layouts/empty-section';

export const RootEmpty = () => {
  const t = useI18n();

  return (
    <NavigationPanelEmptySection
      icon={TagIcon}
      message={t['com.notesgraph.rootAppSidebar.tags.empty']()}
      messageTestId="slider-bar-tags-empty-message"
    />
  );
};
