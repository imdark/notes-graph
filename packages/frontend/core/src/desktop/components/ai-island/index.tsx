import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import { IslandContainer } from './container';
import { AIIcon } from './icons';
import { aiIslandBtn, aiIslandWrapper, toolStyle } from './styles.css';

const hideChat: Array<string | ((path: string) => boolean)> = [
  '/chat',
  path => path.includes('attachments'),
];

export const AIIsland = () => {
  // to make sure ai island is hidden first and animate in
  const [hide, setHide] = useState(true);

  const workbench = useService(WorkbenchService).workbench;
  const activeView = useLiveData(workbench.activeView$);
  const haveChatTab = useLiveData(
    activeView.sidebarTabs$.map(tabs => tabs.some(t => t.id === 'chat'))
  );
  const activeLocation = useLiveData(activeView.location$);
  const activeTab = useLiveData(activeView.activeSidebarTab$);
  const sidebarOpen = useLiveData(workbench.sidebarOpen$);

  useEffect(() => {
    let hide = true;
    if (haveChatTab) {
      hide = !!sidebarOpen && activeTab?.id === 'chat';
    } else {
      const path = activeLocation.pathname;
      hide = hideChat.some(item =>
        typeof item === 'string' ? path === item : item(path)
      );
    }
    setHide(hide);
  }, [activeLocation.pathname, activeTab, haveChatTab, sidebarOpen]);

  const onOpenChat = useCallback(() => {
    if (hide) return;
    if (haveChatTab) {
      // Preferred: the AI chat as a side-menu tab next to the current view.
      workbench.openSidebar();
      activeView.activeSidebarTab('chat');
    } else {
      // No chat side-panel on this page — which is the norm whenever the
      // server doesn't advertise Copilot, since the chat sidebar tab is
      // registered behind that. Chat then has to open as its own view, but
      // opening a fresh one per click stacked up a new split every time.
      // Reuse the chat view if one is already open and just focus it.
      const existing = workbench.views$.value.find(
        view => view.location$.value.pathname === '/chat'
      );
      if (existing) {
        workbench.active(existing);
      } else {
        // Beside the current view rather than taking it over, so the doc
        // being worked on stays visible.
        workbench.open('/chat', { at: 'beside' });
      }
    }
  }, [activeView, haveChatTab, hide, workbench]);

  return (
    <IslandContainer className={clsx(toolStyle, { hide })}>
      <div className={aiIslandWrapper} data-hide={hide}>
        <button
          className={aiIslandBtn}
          data-testid="ai-island"
          onClick={onOpenChat}
        >
          <AIIcon />
        </button>
      </div>
    </IslandContainer>
  );
};
