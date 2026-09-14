import { ImportIcon, PlusIcon } from '@blocksuite/icons/rc';
import type { DocMode } from '@blocksuite/notesgraph/model';
import type { useI18n } from '@notesgraph/i18n';
import { track } from '@notesgraph/track';

import type { usePageHelper } from '../blocksuite/block-suite-page-list/utils';
import type { GlobalDialogService } from '../modules/dialogs';
import type { DocModeRegistryService } from '../modules/doc-mode-registry';
import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphCreationCommands({
  pageHelper,
  t,
  globalDialogService,
  docModeRegistry,
}: {
  t: ReturnType<typeof useI18n>;
  pageHelper: ReturnType<typeof usePageHelper>;
  globalDialogService: GlobalDialogService;
  docModeRegistry: DocModeRegistryService;
}) {
  const unsubs: Array<() => void> = [];
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:new-page',
      category: 'notesgraph:creation',
      label: t['com.notesgraph.cmdk.notesgraph.new-page'](),
      icon: <PlusIcon />,
      keyBinding: BUILD_CONFIG.isElectron
        ? {
            binding: '$mod+N',
            skipRegister: true,
          }
        : undefined,
      run() {
        track.$.cmdk.creation.createDoc({ mode: 'page' });

        pageHelper.createPage('page' as DocMode);
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:new-edgeless-page',
      category: 'notesgraph:creation',
      icon: <PlusIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.new-edgeless-page'](),
      // Only offer "New Edgeless" when the edgeless plugin is installed and
      // enabled (it registers the 'edgeless' mode in DocModeRegistryService).
      preconditionStrategy: () => !!docModeRegistry.get('edgeless'),
      run() {
        track.$.cmdk.creation.createDoc({
          mode: 'edgeless',
        });

        pageHelper.createEdgeless();
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:new-workspace',
      category: 'notesgraph:creation',
      icon: <PlusIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.new-workspace'](),
      run() {
        track.$.cmdk.workspace.createWorkspace();

        globalDialogService.open('create-workspace', {});
      },
    })
  );
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:import-workspace',
      category: 'notesgraph:creation',
      icon: <ImportIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.import-workspace'](),
      preconditionStrategy: () => {
        return BUILD_CONFIG.isElectron;
      },
      run() {
        track.$.cmdk.workspace.createWorkspace({
          control: 'import',
        });

        globalDialogService.open('import-workspace', undefined);
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
