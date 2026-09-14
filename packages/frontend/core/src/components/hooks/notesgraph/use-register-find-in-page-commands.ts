import {
  PreconditionStrategy,
  registerNotesGraphCommand,
} from '@notesgraph/core/commands';
import { FindInPageService } from '@notesgraph/core/modules/find-in-page/services/find-in-page';
import { useServiceOptional } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useEffect } from 'react';

export function useRegisterFindInPageCommands() {
  const findInPage = useServiceOptional(FindInPageService)?.findInPage;
  const showFindInPage = useCallback(() => {
    // get the selected text in page
    const selection = window.getSelection();
    const selectedText = selection?.toString();

    findInPage?.findInPage(selectedText);
  }, [findInPage]);

  useEffect(() => {
    if (!BUILD_CONFIG.isElectron) {
      return;
    }
    const unsubs: Array<() => void> = [];
    unsubs.push(
      registerNotesGraphCommand({
        preconditionStrategy: PreconditionStrategy.Never,
        id: `notesgraph:find-in-page`,
        keyBinding: {
          binding: '$mod+f',
        },
        icon: null,
        label: '',
        run() {
          track.$.cmdk.general.findInPage();
          showFindInPage();
        },
      })
    );

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [findInPage, showFindInPage]);
}
