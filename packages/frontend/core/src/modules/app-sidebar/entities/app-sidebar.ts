import { Entity, LiveData } from '@notesgraph/infra';
import { map } from 'rxjs';

import type { AppSidebarState } from '../providers/storage';

enum APP_SIDEBAR_STATE {
  OPEN = 'open',
  WIDTH = 'width',
  SHOW_FAVORITES = 'showFavorites',
  SHOW_TAGS = 'showTags',
  SHOW_COLLECTIONS = 'showCollections',
  SHOW_NOTES = 'showNotes',
  SHOW_PROJECTS = 'showProjects',
}

export class AppSidebar extends Entity {
  constructor(private readonly appSidebarState: AppSidebarState) {
    super();
  }

  /**
   * whether the sidebar is open,
   * even if the sidebar is not open, hovering can show the floating sidebar
   */
  open$ = LiveData.from(
    this.appSidebarState
      .watch<boolean>(APP_SIDEBAR_STATE.OPEN)
      .pipe(map(value => value ?? true)),
    this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.OPEN) ?? true
  );

  width$ = LiveData.from(
    this.appSidebarState
      .watch<number>(APP_SIDEBAR_STATE.WIDTH)
      .pipe(map(value => value ?? 248)),
    this.appSidebarState.get<number>(APP_SIDEBAR_STATE.WIDTH) ?? 248
  );

  /**
   * Per-section sidebar visibility (favorites / tags / collections). Each is
   * hidden by default to keep the sidebar focused on navigation and the graph;
   * toggled individually from Settings → Appearance.
   */
  showFavorites$ = LiveData.from(
    this.appSidebarState
      .watch<boolean>(APP_SIDEBAR_STATE.SHOW_FAVORITES)
      .pipe(map(value => value ?? false)),
    this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.SHOW_FAVORITES) ?? false
  );

  showTags$ = LiveData.from(
    this.appSidebarState
      .watch<boolean>(APP_SIDEBAR_STATE.SHOW_TAGS)
      .pipe(map(value => value ?? false)),
    this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.SHOW_TAGS) ?? false
  );

  showCollections$ = LiveData.from(
    this.appSidebarState
      .watch<boolean>(APP_SIDEBAR_STATE.SHOW_COLLECTIONS)
      .pipe(map(value => value ?? false)),
    this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.SHOW_COLLECTIONS) ??
      false
  );

  /**
   * Notes and Projects are the primary content sections, so unlike the sections
   * above they default to **visible** — the toggle only lets a user hide a
   * section they don't use. `?? true` preserves the previous always-on behavior
   * for anyone who never touches the setting.
   */
  showNotes$ = LiveData.from(
    this.appSidebarState
      .watch<boolean>(APP_SIDEBAR_STATE.SHOW_NOTES)
      .pipe(map(value => value ?? true)),
    this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.SHOW_NOTES) ?? true
  );

  showProjects$ = LiveData.from(
    this.appSidebarState
      .watch<boolean>(APP_SIDEBAR_STATE.SHOW_PROJECTS)
      .pipe(map(value => value ?? true)),
    this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.SHOW_PROJECTS) ?? true
  );

  /**
   * hovering can show the floating sidebar, without open it
   */
  hovering$ = new LiveData<boolean>(false);

  /**
   * prevent it from setting hovering once when the sidebar is closed
   */
  preventHovering$ = new LiveData<boolean>(false);

  /**
   * small screen mode, will disable hover effect
   */
  smallScreenMode$ = new LiveData<boolean>(false);
  resizing$ = new LiveData<boolean>(false);

  getCachedAppSidebarOpenState = () => {
    return this.appSidebarState.get<boolean>(APP_SIDEBAR_STATE.OPEN);
  };

  toggleSidebar = () => {
    this.setOpen(!this.open$.value);
  };

  setOpen = (open: boolean) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.OPEN, open);
    return;
  };

  setSmallScreenMode = (smallScreenMode: boolean) => {
    this.smallScreenMode$.next(smallScreenMode);
  };

  setHovering = (hoverFloating: boolean) => {
    this.hovering$.next(hoverFloating);
  };

  setPreventHovering = (preventHovering: boolean) => {
    this.preventHovering$.next(preventHovering);
  };

  setResizing = (resizing: boolean) => {
    this.resizing$.next(resizing);
  };

  setWidth = (width: number) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.WIDTH, width);
  };

  setShowFavorites = (show: boolean) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.SHOW_FAVORITES, show);
  };

  setShowTags = (show: boolean) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.SHOW_TAGS, show);
  };

  setShowCollections = (show: boolean) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.SHOW_COLLECTIONS, show);
  };

  setShowNotes = (show: boolean) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.SHOW_NOTES, show);
  };

  setShowProjects = (show: boolean) => {
    this.appSidebarState.set(APP_SIDEBAR_STATE.SHOW_PROJECTS, show);
  };
}
