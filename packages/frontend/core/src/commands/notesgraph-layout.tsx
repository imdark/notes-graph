import { SidebarIcon } from '@blocksuite/icons/rc';
import type { useI18n } from '@notesgraph/i18n';
import { track } from '@notesgraph/track';

import type { AppSidebarService } from '../modules/app-sidebar';
import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphLayoutCommands({
  t,
  appSidebarService,
}: {
  t: ReturnType<typeof useI18n>;
  appSidebarService: AppSidebarService;
}) {
  const unsubs: Array<() => void> = [];
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:toggle-left-sidebar',
      category: 'notesgraph:layout',
      icon: <SidebarIcon />,
      label: () =>
        appSidebarService.sidebar.open$.value
          ? t['com.notesgraph.cmdk.notesgraph.left-sidebar.collapse']()
          : t['com.notesgraph.cmdk.notesgraph.left-sidebar.expand'](),

      keyBinding: {
        binding: '$mod+/',
      },
      run() {
        track.$.navigationPanel.$.toggle({
          type: appSidebarService.sidebar.open$.value ? 'collapse' : 'expand',
        });
        appSidebarService.sidebar.toggleSidebar();
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
