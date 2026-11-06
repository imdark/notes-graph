import { SafeArea, useThemeColorV2 } from '@notesgraph/component';
import {
  NavigationPanelNotes,
  NotesTreeDocNodeContext,
} from '@notesgraph/core/desktop/components/navigation-panel';

import { AppTabs } from '../../components';
import {
  NavigationPanelCollections,
  NavigationPanelFavorites,
  NavigationPanelOrganize,
  NavigationPanelProjects,
  NavigationPanelTags,
} from '../../components/navigation';
import { NavigationPanelDocNode } from '../../components/navigation/nodes/doc';
import { HomeHeader, RecentDocs } from '../../views';

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');

  return (
    <>
      <HomeHeader />
      <RecentDocs />
      <SafeArea bottom>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 32,
            padding: '0 8px 32px 8px',
          }}
        >
          <NavigationPanelFavorites />
          <NavigationPanelProjects />
          {/* The notes tree renders the mobile doc row: no drag and drop,
              tooltips or hover menus, which matters with hundreds of rows. */}
          <NotesTreeDocNodeContext.Provider value={NavigationPanelDocNode}>
            <NavigationPanelNotes />
          </NotesTreeDocNodeContext.Provider>
          <NavigationPanelOrganize />
          <NavigationPanelCollections />
          <NavigationPanelTags />
        </div>
      </SafeArea>
      <AppTabs />
    </>
  );
};
