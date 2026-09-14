import { SidebarExtension } from '@blocksuite/notesgraph/shared/services';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import type { FrameworkProvider } from '@notesgraph/infra';

export function patchSideBarService(framework: FrameworkProvider) {
  const { workbench } = framework.get(WorkbenchService);

  return SidebarExtension({
    open: (tabId?: string) => {
      workbench.openSidebar();
      workbench.activeView$.value.activeSidebarTab(tabId ?? null);
    },
    close: () => {
      workbench.closeSidebar();
    },
    getTabIds: () => {
      return workbench.activeView$.value.sidebarTabs$.value.map(tab => tab.id);
    },
  });
}
