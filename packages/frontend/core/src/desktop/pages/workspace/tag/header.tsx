import { ExplorerDisplayMenuButton } from '@notesgraph/core/components/explorer/display-menu';
import { ExplorerNavigation } from '@notesgraph/core/components/explorer/header/navigation';
import type { ExplorerDisplayPreference } from '@notesgraph/core/components/explorer/types';
import { Header } from '@notesgraph/core/components/pure/header';

export const TagDetailHeader = ({
  displayPreference,
  onDisplayPreferenceChange,
}: {
  displayPreference: ExplorerDisplayPreference;
  onDisplayPreferenceChange: (
    displayPreference: ExplorerDisplayPreference
  ) => void;
}) => {
  return (
    <Header
      left={<ExplorerNavigation active={'tags'} />}
      right={
        <ExplorerDisplayMenuButton
          displayPreference={displayPreference}
          onDisplayPreferenceChange={onDisplayPreferenceChange}
        />
      }
    />
  );
};
