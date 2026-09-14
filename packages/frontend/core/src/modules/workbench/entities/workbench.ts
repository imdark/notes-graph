import type { ReferenceParams } from '@blocksuite/notesgraph/model';
import { toDocSearchParams } from '@notesgraph/core/modules/navigation/utils';
import { Unreachable } from '@notesgraph/env/constant';
import { Entity, LiveData } from '@notesgraph/infra';
import { type To } from 'history';
import { omit } from 'lodash-es';
import { nanoid } from 'nanoid';

import type { GlobalState } from '../../storage';
import type { WorkbenchNewTabHandler } from '../services/workbench-new-tab-handler';
import type { WorkbenchDefaultState } from '../services/workbench-view-state';
import { View } from './view';

export type WorkbenchPosition = 'beside' | 'active' | 'head' | 'tail' | number;

export type WorkbenchOpenOptions = {
  at?: WorkbenchPosition | 'new-tab';
  replaceHistory?: boolean;
  show?: boolean; // only for new tab
};

const sidebarOpenKey = 'workbenchSidebarOpen';
const sidebarWidthKey = 'workbenchSidebarWidth';
const workspaceSelectorOpenKey = 'workspaceSelectorOpen';

export class Workbench extends Entity {
  constructor(
    private readonly defaultState: WorkbenchDefaultState,
    private readonly newTabHandler: WorkbenchNewTabHandler,
    private readonly globalState: GlobalState
  ) {
    super();
  }

  readonly activeViewIndex$ = new LiveData(this.defaultState.activeViewIndex);
  readonly basename$ = new LiveData(this.defaultState.basename);

  // All views restored on startup belong to the same tab (on desktop a
  // workbench *is* one tab and its views are that tab's split panes; on the
  // browser it starts as a single view). New in-app tabs get fresh ids.
  private readonly initialTabId = nanoid();

  readonly views$: LiveData<View[]> = new LiveData(
    this.defaultState.views.map(meta => {
      return this.framework.createEntity(View, {
        id: meta.id,
        defaultLocation: meta.path,
        icon: meta.icon,
        title: meta.title,
        tabId: this.initialTabId,
      });
    })
  );

  activeView$ = LiveData.computed(get => {
    const activeIndex = get(this.activeViewIndex$);
    const views = get(this.views$);
    // activeIndex could be out of bounds when reordering views
    return views.at(activeIndex) || views[0];
  });

  /** The tab (split group) the active view belongs to. */
  activeTabId$ = LiveData.computed(get => get(this.activeView$)?.tabId);

  /**
   * Open tabs in order. Each tab is a group of views (its split panes) sharing
   * a `tabId`; same-tab views are kept contiguous in `views$`, so a tab is a
   * slice. Only the active tab's views render side by side.
   */
  tabs$ = LiveData.computed(get => {
    const views = get(this.views$);
    const groups: { tabId: string; views: View[]; startIndex: number }[] = [];
    const byId = new Map<string, (typeof groups)[number]>();
    views.forEach((view, index) => {
      let group = byId.get(view.tabId);
      if (!group) {
        group = { tabId: view.tabId, views: [], startIndex: index };
        byId.set(view.tabId, group);
        groups.push(group);
      }
      group.views.push(view);
    });
    return groups;
  });

  /** The active tab's views (its split panes) — what actually renders. */
  activeTabViews$ = LiveData.computed(get => {
    const tabId = get(this.activeTabId$);
    return get(this.views$).filter(view => view.tabId === tabId);
  });

  /** Index in `views$` of the active tab's first view (for offsetting). */
  activeTabStartIndex$ = LiveData.computed(get => {
    const tabId = get(this.activeTabId$);
    const index = get(this.views$).findIndex(view => view.tabId === tabId);
    return index === -1 ? 0 : index;
  });

  location$ = LiveData.computed(get => {
    return get(get(this.activeView$).location$);
  });
  sidebarOpen$ = LiveData.from(
    this.globalState.watch<boolean>(sidebarOpenKey),
    this.globalState.get<boolean>(sidebarOpenKey) ?? false
  );
  setSidebarOpen(open: boolean) {
    this.globalState.set(sidebarOpenKey, open);
  }
  sidebarWidth$ = LiveData.from(
    this.globalState.watch<number>(sidebarWidthKey),
    this.globalState.get<number>(sidebarWidthKey) ?? 320
  );
  setSidebarWidth(width: number) {
    this.globalState.set(sidebarWidthKey, width);
  }

  workspaceSelectorOpen$ = LiveData.from(
    this.globalState.watch<boolean>(workspaceSelectorOpenKey),
    this.globalState.get<boolean>(workspaceSelectorOpenKey) ?? false
  );
  setWorkspaceSelectorOpen(open: boolean) {
    this.globalState.set(workspaceSelectorOpenKey, open);
  }

  active(index: number | View) {
    if (typeof index === 'number') {
      index = Math.max(0, Math.min(index, this.views$.value.length - 1));
      this.activeViewIndex$.next(index);
    } else {
      this.activeViewIndex$.next(this.views$.value.indexOf(index));
    }
  }

  updateBasename(basename: string) {
    this.basename$.next(basename);
  }

  createView(
    at: WorkbenchPosition = 'beside',
    defaultLocation: To,
    active = true,
    // Which tab the new view joins. Omitted → the active view's tab, i.e. a
    // split pane in the current tab. Pass a fresh id for a brand-new tab.
    tabId: string = this.activeView$.value?.tabId ?? this.initialTabId
  ) {
    const view = this.framework.createEntity(View, {
      id: nanoid(),
      defaultLocation,
      tabId,
    });
    const newViews = [...this.views$.value];
    newViews.splice(this.indexAt(at), 0, view);
    this.views$.next(newViews);
    const index = newViews.indexOf(view);
    if (active) {
      this.active(index);
    }
    return index;
  }

  /**
   * Open a location in a new in-app tab (a fresh single-view tab appended at
   * the end), and activate it. This is the "+" / new-tab action — distinct
   * from a split, which adds a pane to the current tab.
   */
  newInAppTab(to: To = '/all') {
    return this.createView('tail', to, true, nanoid());
  }

  /**
   * Split the current tab: add a pane beside the active view, in the same tab,
   * so the two render side by side. Defaults to the active view's current
   * location (a "split right" of what you're looking at).
   */
  splitView(to?: To) {
    const active = this.activeView$.value;
    const location = to ?? active?.history.location ?? '/all';
    return this.createView('beside', location, true, active?.tabId);
  }

  openSidebar() {
    this.setSidebarOpen(true);
  }

  closeSidebar() {
    this.setSidebarOpen(false);
  }

  toggleSidebar() {
    this.setSidebarOpen(!this.sidebarOpen$.value);
  }

  openWorkspaceSelector() {
    this.setWorkspaceSelectorOpen(true);
  }

  closeWorkspaceSelector() {
    this.setWorkspaceSelectorOpen(false);
  }

  toggleWorkspaceSelector() {
    this.setWorkspaceSelectorOpen(!this.workspaceSelectorOpen$.value);
  }

  open(to: To, option: WorkbenchOpenOptions = {}) {
    if (option.at === 'new-tab') {
      this.newTab(to, {
        show: option.show,
      });
    } else {
      const { at = 'active', replaceHistory = false } = option;
      let view = this.viewAt(at);
      if (!view) {
        const newIndex = this.createView(at, to, option.show);
        view = this.viewAt(newIndex);
        if (!view) {
          throw new Unreachable();
        }
      } else {
        if (replaceHistory) {
          view.history.replace(to);
        } else {
          view.history.push(to);
        }
      }
    }
  }

  newTab(
    to: To,
    {
      show,
    }: {
      show?: boolean;
    } = {}
  ) {
    this.newTabHandler.handle({
      basename: this.basename$.value,
      to,
      show: show ?? true,
    });
  }

  openDoc(
    id:
      | string
      | ({
          docId: string;
          refreshKey?: string;
          fromTab?: string;
        } & ReferenceParams),
    options?: WorkbenchOpenOptions
  ) {
    const isString = typeof id === 'string';
    const docId = isString ? id : id.docId;

    let query = '';
    if (!isString) {
      const search = toDocSearchParams(omit(id, ['docId']));
      if (search?.size) {
        query = `?${search.toString()}`;
      }
    }

    this.open(`/${docId}${query}`, options);
  }

  openAttachment(
    docId: string,
    blockId: string,
    options?: WorkbenchOpenOptions
  ) {
    this.open(`/${docId}/attachments/${blockId}`, options);
  }

  openCollections(options?: WorkbenchOpenOptions) {
    this.open('/collection', options);
  }

  openCollection(collectionId: string, options?: WorkbenchOpenOptions) {
    this.open(`/collection/${collectionId}`, options);
  }

  openAll(options?: WorkbenchOpenOptions) {
    this.open('/all', options);
  }

  openTrash(options?: WorkbenchOpenOptions) {
    this.open('/trash', options);
  }

  openTags(options?: WorkbenchOpenOptions) {
    this.open('/tag', options);
  }

  openTag(tagId: string, options?: WorkbenchOpenOptions) {
    this.open(`/tag/${tagId}`, options);
  }

  viewAt(positionIndex: WorkbenchPosition): View | undefined {
    return this.views$.value[this.indexAt(positionIndex)];
  }

  close(view: View) {
    if (this.views$.value.length === 1) return;
    const index = this.views$.value.indexOf(view);
    if (index === -1) return;
    const newViews = [...this.views$.value];
    newViews.splice(index, 1);
    const activeViewIndex = this.activeViewIndex$.value;
    if (activeViewIndex !== 0 && activeViewIndex >= index) {
      this.active(activeViewIndex - 1);
    }
    this.views$.next(newViews);
  }

  closeOthers(view: View) {
    view.size$.next(100);
    // Close the other panes in this tab; leave other tabs untouched.
    this.views$.next(
      this.views$.value.filter(v => v.tabId !== view.tabId || v === view)
    );
    this.active(view);
  }

  /** Activate a tab by focusing its first view. */
  activateTab(tabId: string) {
    const view = this.views$.value.find(v => v.tabId === tabId);
    if (view) {
      this.active(view);
    }
  }

  /** Close a whole tab (all of its split panes). Never closes the last tab. */
  closeTab(tabId: string) {
    const remaining = this.views$.value.filter(v => v.tabId !== tabId);
    if (remaining.length === 0) return;
    const wasActive = this.activeView$.value?.tabId === tabId;
    this.views$.next(remaining);
    if (wasActive) {
      this.active(0);
    }
  }

  /** Close every tab except the given one (keeps its split panes). */
  closeOtherTabs(tabId: string) {
    const keep = this.views$.value.filter(v => v.tabId === tabId);
    if (keep.length === 0) return;
    this.views$.next(keep);
    this.active(0);
  }

  moveView(from: number, to: number) {
    from = Math.max(0, Math.min(from, this.views$.value.length - 1));
    to = Math.max(0, Math.min(to, this.views$.value.length - 1));
    if (from === to) return;
    const views = [...this.views$.value];
    const fromView = views[from];
    const toView = views[to];
    views[to] = fromView;
    views[from] = toView;
    this.views$.next(views);
    this.active(to);
  }

  /**
   * resize specified view and the next view
   * @param view
   * @param percent from 0 to 1
   * @returns
   */
  resize(index: number, percent: number) {
    const view = this.views$.value[index];
    const nextView = this.views$.value[index + 1];
    if (!nextView) return;

    const totalViewSize = this.views$.value.reduce(
      (sum, v) => sum + v.size$.value,
      0
    );
    const percentOfTotal = totalViewSize * percent;
    const newSize = Number((view.size$.value + percentOfTotal).toFixed(4));
    const newNextSize = Number(
      (nextView.size$.value - percentOfTotal).toFixed(4)
    );
    // TODO(@catsjuice): better strategy to limit size
    if (newSize / totalViewSize < 0.2 || newNextSize / totalViewSize < 0.2)
      return;
    view.setSize(newSize);
    nextView.setSize(newNextSize);
  }

  private indexAt(positionIndex: WorkbenchPosition): number {
    if (positionIndex === 'active') {
      return this.activeViewIndex$.value;
    }
    if (positionIndex === 'beside') {
      return this.activeViewIndex$.value + 1;
    }
    if (positionIndex === 'head') {
      return 0;
    }
    if (positionIndex === 'tail') {
      return this.views$.value.length;
    }
    return positionIndex;
  }
}
