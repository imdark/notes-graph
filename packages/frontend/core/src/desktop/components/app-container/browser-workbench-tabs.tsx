import {
  ArrowDownSmallIcon,
  CloseIcon,
  InsertRightIcon,
  PageIcon,
  PlusIcon,
} from '@blocksuite/icons/rc';
import { Menu, MenuItem } from '@notesgraph/component';
import {
  type Workbench,
  WorkbenchService,
  type WorkbenchView as View,
} from '@notesgraph/core/modules/workbench';
import { useLiveData, useServiceOptional } from '@notesgraph/infra';
import clsx from 'clsx';
import { useCallback } from 'react';

import * as styles from './browser-workbench-tabs.css';

interface Tab {
  tabId: string;
  views: View[];
  startIndex: number;
}

const WorkbenchTabItem = ({
  tab,
  active,
  activeView,
  canClose,
  workbench,
}: {
  tab: Tab;
  active: boolean;
  activeView: View | undefined;
  canClose: boolean;
  workbench: Workbench;
}) => {
  // The active tab shows the focused pane's title; others show their first.
  const representative =
    active && activeView && tab.views.includes(activeView)
      ? activeView
      : tab.views[0];
  const title = useLiveData(representative.title$);
  const paneCount = tab.views.length;

  const menu = (
    <>
      <MenuItem
        prefixIcon={<InsertRightIcon />}
        data-testid="workbench-tab-split"
        onClick={() => {
          workbench.activateTab(tab.tabId);
          workbench.splitView();
        }}
      >
        Split right
      </MenuItem>
      {canClose ? (
        <MenuItem
          prefixIcon={<CloseIcon />}
          onClick={() => workbench.closeTab(tab.tabId)}
        >
          Close
        </MenuItem>
      ) : null}
      {canClose ? (
        <MenuItem onClick={() => workbench.closeOtherTabs(tab.tabId)}>
          Close others
        </MenuItem>
      ) : null}
    </>
  );

  return (
    <div
      className={clsx(styles.tab, { [styles.tabActive]: active })}
      data-testid="workbench-tab"
      data-active={active}
      data-split={paneCount > 1}
      role="button"
      tabIndex={0}
      onClick={() => workbench.activateTab(tab.tabId)}
    >
      <PageIcon className={styles.tabIcon} />
      <span className={styles.tabTitle}>
        {title || 'Untitled'}
        {paneCount > 1 ? ` +${paneCount - 1}` : ''}
      </span>
      <Menu items={menu}>
        <span
          role="button"
          aria-label="Tab menu"
          className={styles.tabCaret}
          data-testid="workbench-tab-menu"
          onClick={e => e.stopPropagation()}
        >
          <ArrowDownSmallIcon />
        </span>
      </Menu>
      {canClose ? (
        <span
          role="button"
          aria-label="Close tab"
          className={styles.tabClose}
          data-testid="workbench-tab-close"
          onClick={e => {
            e.stopPropagation();
            workbench.closeTab(tab.tabId);
          }}
        >
          <CloseIcon />
        </span>
      ) : null}
    </div>
  );
};

/**
 * Browser-only strip of tabs across the top of the workbench. Each tab is a
 * group of views sharing a `tabId`; a tab with more than one view is a split
 * (its panes render side by side). Click a tab to focus it, the ▾ menu to
 * split/close, × to close, + to open a new (single-view) tab. Only the active
 * tab renders. Electron uses its native AppTabsHeader instead.
 */
export const BrowserWorkbenchTabs = () => {
  const workbench = useServiceOptional(WorkbenchService)?.workbench;
  const tabs = useLiveData(workbench?.tabs$);
  const activeTabId = useLiveData(workbench?.activeTabId$);
  const activeView = useLiveData(workbench?.activeView$);

  const onNewTab = useCallback(() => {
    workbench?.newInAppTab('/all');
  }, [workbench]);

  if (!workbench || !tabs || tabs.length === 0) return null;

  return (
    <div className={styles.tabBar} data-testid="workbench-tabs">
      <div className={styles.tabs}>
        {tabs.map(tab => (
          <WorkbenchTabItem
            key={tab.tabId}
            tab={tab}
            active={tab.tabId === activeTabId}
            activeView={activeView}
            canClose={tabs.length > 1}
            workbench={workbench}
          />
        ))}
      </div>
      <button
        type="button"
        className={styles.addTab}
        aria-label="New tab"
        data-testid="workbench-tab-add"
        onClick={onNewTab}
      >
        <PlusIcon />
      </button>
    </div>
  );
};
