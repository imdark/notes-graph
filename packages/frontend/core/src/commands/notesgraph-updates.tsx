import { ResetIcon } from '@blocksuite/icons/rc';
import { notify } from '@notesgraph/component';
import { updateReadyAtom } from '@notesgraph/core/components/hooks/use-app-updater';
import type { useI18n } from '@notesgraph/i18n';
import { track } from '@notesgraph/track';
import type { createStore } from 'jotai';

import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphUpdatesCommands({
  t,
  store,
  quitAndInstall,
}: {
  t: ReturnType<typeof useI18n>;
  store: ReturnType<typeof createStore>;
  quitAndInstall: () => Promise<void>;
}) {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:restart-to-upgrade',
      category: 'notesgraph:updates',
      icon: <ResetIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.restart-to-upgrade'](),
      preconditionStrategy: () => !!store.get(updateReadyAtom),
      run() {
        track.$.cmdk.updates.quitAndInstall();

        quitAndInstall().catch(err => {
          notify.error({
            title: 'Failed to restart to upgrade',
            message: 'Please restart the app manually to upgrade.',
          });
          console.error(err);
        });
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
