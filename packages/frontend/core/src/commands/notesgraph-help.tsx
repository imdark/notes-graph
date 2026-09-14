import { ContactWithUsIcon, NewIcon } from '@blocksuite/icons/rc';
import type { useI18n } from '@notesgraph/i18n';
import { track } from '@notesgraph/track';

import type { WorkspaceDialogService } from '../modules/dialogs';
import type { UrlService } from '../modules/url';
import { registerNotesGraphCommand } from './registry';

export function registerNotesGraphHelpCommands({
  t,
  urlService,
  workspaceDialogService,
}: {
  t: ReturnType<typeof useI18n>;
  urlService: UrlService;
  workspaceDialogService: WorkspaceDialogService;
}) {
  const unsubs: Array<() => void> = [];
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:help-whats-new',
      category: 'notesgraph:help',
      icon: <NewIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.whats-new'](),
      run() {
        track.$.cmdk.help.openChangelog();
        urlService.openPopupWindow(BUILD_CONFIG.changelogUrl);
      },
    })
  );
  unsubs.push(
    registerNotesGraphCommand({
      id: 'notesgraph:help-contact-us',
      category: 'notesgraph:help',
      icon: <ContactWithUsIcon />,
      label: t['com.notesgraph.cmdk.notesgraph.contact-us'](),
      run() {
        track.$.cmdk.help.contactUs();
        workspaceDialogService.open('setting', {
          activeTab: 'about',
        });
      },
    })
  );

  return () => {
    unsubs.forEach(unsub => unsub());
  };
}
