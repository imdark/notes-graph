import { ViewLayersIcon } from '@blocksuite/icons/rc';
import { useI18n } from '@notesgraph/i18n';

import { NavigationPanelEmptySection } from '../../layouts/empty-section';

export const RootEmpty = ({
  onClickCreate,
}: {
  onClickCreate?: () => void;
}) => {
  const t = useI18n();

  return (
    <NavigationPanelEmptySection
      icon={ViewLayersIcon}
      message={t['com.notesgraph.collections.empty.message']()}
      messageTestId="slider-bar-collection-empty-message"
      actionText={t['com.notesgraph.collections.empty.new-collection-button']()}
      onActionClick={onClickCreate}
    />
  );
};
