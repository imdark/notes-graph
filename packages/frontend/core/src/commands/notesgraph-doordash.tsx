import { notify } from '@notesgraph/component';
import { ImportIcon } from '@blocksuite/icons/rc';
import type { useI18n } from '@notesgraph/i18n';

import type { DesktopApiService } from '../modules/desktop-api';
import type { DocsService } from '../modules/doc';
import type { WorkbenchService } from '../modules/workbench';
import { registerNotesGraphCommand } from './registry';

/**
 * Desktop-only: open a browser window for the user to log into DoorDash, crawl
 * their order history (see the electron `doordash` main handler), and drop the
 * orders into a new doc in the current workspace.
 */
export function registerDoorDashCommands({
  t: _t,
  desktopApiService,
  docsService,
  workbenchService,
}: {
  t: ReturnType<typeof useI18n>;
  desktopApiService?: DesktopApiService;
  docsService: DocsService;
  workbenchService?: WorkbenchService;
}) {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:import-doordash-orders',
      category: 'notesgraph:creation',
      icon: <ImportIcon />,
      label: 'Import DoorDash orders',
      // Requires the Electron main handler that opens the login window.
      preconditionStrategy: () =>
        BUILD_CONFIG.isElectron && !!desktopApiService,
      async run() {
        if (!desktopApiService) {
          return;
        }
        try {
          const orders = await desktopApiService.handler.doordash.importOrders();
          if (!orders || orders.length === 0) {
            notify.warning({
              title: 'No DoorDash orders found',
              message:
                'Nothing was captured — make sure your order history had loaded before you clicked Import.',
            });
            return;
          }
          const docId = await docsService.createDoorDashOrdersDoc(orders);
          workbenchService?.workbench.openDoc(docId);
          notify.success({
            title: `Imported ${orders.length} DoorDash order${orders.length === 1 ? '' : 's'}`,
          });
        } catch (error) {
          console.error('DoorDash import failed', error);
          notify.error({
            title: 'DoorDash import failed',
            message: String((error as Error)?.message ?? error),
          });
        }
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
