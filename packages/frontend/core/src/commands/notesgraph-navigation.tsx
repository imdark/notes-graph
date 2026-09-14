import { ArrowRightBigIcon } from '@blocksuite/icons/rc';
import type { Workspace } from '@blocksuite/notesgraph/store';
import type { useI18n } from '@notesgraph/i18n';
import { track } from '@notesgraph/track';

import type { useNavigateHelper } from '../components/hooks/use-navigate-helper';
import type { WorkspaceDialogService } from '../modules/dialogs';
import type { WorkbenchService } from '../modules/workbench';
import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphNavigationCommands({
  t,
  docCollection,
  navigationHelper,
  workspaceDialogService,
  workbenchService,
}: {
  t: ReturnType<typeof useI18n>;
  navigationHelper: ReturnType<typeof useNavigateHelper>;
  docCollection: Workspace;
  workspaceDialogService: WorkspaceDialogService;
  workbenchService?: WorkbenchService;
}) {
  const unsubs: Array<() => void> = [];
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:goto-all-pages',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.navigation.goto-all-pages'](),
      run() {
        track.$.cmdk.navigation.navigate({
          to: 'allDocs',
        });

        navigationHelper.jumpToPage(docCollection.id, 'all');
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:goto-collection-list',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label: 'Go to Collection List',
      run() {
        track.$.cmdk.navigation.navigate({
          to: 'collectionList',
        });

        navigationHelper.jumpToCollections(docCollection.id);
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:goto-tag-list',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label: 'Go to Tag List',
      run() {
        track.$.cmdk.navigation.navigate({
          to: 'tagList',
        });

        navigationHelper.jumpToTags(docCollection.id);
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:goto-workspace',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.navigation.goto-workspace'](),
      run() {
        track.$.cmdk.navigation.navigate({
          to: 'workspace',
        });

        workbenchService?.workbench.openWorkspaceSelector();
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:open-settings',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.navigation.open-settings'](),
      keyBinding: '$mod+,',
      run() {
        track.$.cmdk.settings.openSettings();
        workspaceDialogService.open('setting', {
          activeTab: 'appearance',
        });
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:open-account',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label:
        t['com.notesgraph.cmdk.notesgraph.navigation.open-account-settings'](),
      run() {
        track.$.cmdk.settings.openSettings({ to: 'account' });
        workspaceDialogService.open('setting', {
          activeTab: 'account',
        });
      },
    })
  );

  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:goto-trash',
      category: 'notesgraph:navigation',
      icon: <ArrowRightBigIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.navigation.goto-trash'](),
      run() {
        track.$.cmdk.navigation.navigate({
          to: 'trash',
        });

        navigationHelper.jumpToPage(docCollection.id, 'trash');
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
