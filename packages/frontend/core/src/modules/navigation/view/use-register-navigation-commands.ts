import {
  PreconditionStrategy,
  registerNotesGraphCommand,
} from '@notesgraph/core/commands';
import { useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useEffect } from 'react';

import { NavigatorService } from '../services/navigator';

export function useRegisterNavigationCommands() {
  const navigator = useService(NavigatorService).navigator;
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      registerNotesGraphCommand({
        id: 'notesgraph:shortcut-history-go-back',
        category: 'notesgraph:general',
        preconditionStrategy: PreconditionStrategy.Never,
        icon: 'none',
        label: 'go back',
        keyBinding: {
          binding: '$mod+[',
        },
        run() {
          track.$.cmdk.general.goBack();

          navigator.back();
        },
      })
    );
    unsubs.push(
      registerNotesGraphCommand({
        id: 'notesgraph:shortcut-history-go-forward',
        category: 'notesgraph:general',
        preconditionStrategy: PreconditionStrategy.Never,
        icon: 'none',
        label: 'go forward',
        keyBinding: {
          binding: '$mod+]',
        },
        run() {
          track.$.cmdk.general.goForward();

          navigator.forward();
        },
      })
    );

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [navigator]);
}
