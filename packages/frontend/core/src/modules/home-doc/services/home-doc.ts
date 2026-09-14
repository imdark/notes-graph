import { LiveData, Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import type { GlobalStateService } from '../../storage';
import type { WorkspaceService } from '../../workspace';

/**
 * The "Home" doc is the always-present root of a workspace's note tree (and the
 * root of the graph). It's a real, openable, linkable doc — but it is pinned as
 * the root regardless of what links to it. Its id is created on first use and
 * persisted per workspace.
 */
export class HomeDocService extends Service {
  constructor(
    private readonly globalStateService: GlobalStateService,
    private readonly docsService: DocsService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  private get key() {
    return `notesgraph:home-doc:${this.workspaceService.workspace.id}`;
  }

  readonly homeDocId$ = LiveData.from(
    this.globalStateService.globalState.watch<string>(this.key),
    undefined
  );

  private creating = false;
  private waitingForSync = false;
  private waitingForStored = false;
  private lastCreatedId: string | undefined;

  private isValid(id: string | undefined): id is string {
    if (!id) {
      return false;
    }
    const record = this.docsService.list.doc$(id).value;
    return !!record && !record.trash$.value;
  }

  /**
   * An existing non-trashed doc titled "Home" (oldest wins), so a workspace that
   * already has a Home is adopted instead of getting a fresh duplicate — e.g.
   * when this device never stored the id (a different browser, cleared local
   * state) but the Home synced in from the server.
   */
  private findExistingHome(): string | undefined {
    return this.docsService.list.docs$.value
      .filter(
        record =>
          !record.trash$.value &&
          (record.title$.value ?? '').trim() === 'Home'
      )
      .sort(
        (a, b) => (a.createdAt$.value ?? 0) - (b.createdAt$.value ?? 0)
      )[0]?.id;
  }

  /**
   * Ensure a Home doc exists, creating it on first use and persisting its id.
   * Idempotent and guarded so concurrent callers (the sidebar and the graph)
   * can both call it without ever creating duplicates.
   *
   * Crucially, it waits for the workspace to finish syncing before deciding.
   * Otherwise, on every app open (and after every deploy reload) the doc list
   * hasn't loaded yet, the existing Home looks missing, and a fresh duplicate
   * is created — the exact bug this guards against.
   */
  ensureHomeDoc() {
    if (this.docsService.list.isReady$.value) {
      this.resolveHomeDoc();
      return;
    }
    if (this.waitingForSync) {
      return;
    }
    this.waitingForSync = true;
    const subscription = this.docsService.list.isReady$.subscribe(ready => {
      if (!ready) {
        return;
      }
      subscription.unsubscribe();
      this.waitingForSync = false;
      this.resolveHomeDoc();
    });
    this.disposables.push(() => subscription.unsubscribe());
  }

  private resolveHomeDoc() {
    const stored = this.homeDocId$.value ?? this.lastCreatedId;
    if (this.creating || this.isValid(stored)) {
      return;
    }

    // We already have a Home id from a previous session, but its doc isn't in
    // the list yet — `synced` can flip true before this specific doc has been
    // pulled in (common right after a deploy reload). Wait for it rather than
    // minting a duplicate (the "Home recreated on every deploy" bug). Only if it
    // truly never arrives (e.g. the Home was deleted) do we fall back.
    if (stored) {
      this.waitForStoredHome(stored);
      return;
    }

    this.adoptOrCreateHome();
  }

  private waitForStoredHome(id: string) {
    if (this.waitingForStored) {
      return;
    }
    this.waitingForStored = true;
    let settled = false;
    let sub: { unsubscribe(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.waitingForStored = false;
      if (timer) clearTimeout(timer);
      sub?.unsubscribe();
    };
    sub = this.docsService.list.doc$(id).subscribe(record => {
      // The stored Home finally synced in — re-persist and stop; never create.
      if (record && !record.trash$.value) {
        this.lastCreatedId = id;
        this.globalStateService.globalState.set(this.key, id);
        finish();
      }
    });
    if (settled) return; // resolved synchronously
    timer = setTimeout(() => {
      finish();
      if (!this.isValid(this.homeDocId$.value ?? this.lastCreatedId)) {
        this.adoptOrCreateHome();
      }
    }, 10_000);
    this.disposables.push(finish);
  }

  private adoptOrCreateHome() {
    if (this.creating || this.isValid(this.homeDocId$.value ?? this.lastCreatedId)) {
      return;
    }
    // Prefer adopting an already-present Home over minting another one.
    const existing = this.findExistingHome();
    if (existing) {
      this.lastCreatedId = existing;
      this.globalStateService.globalState.set(this.key, existing);
      return;
    }

    this.creating = true;
    try {
      const record = this.docsService.createDoc({ title: 'Home' });
      this.lastCreatedId = record.id;
      this.globalStateService.globalState.set(this.key, record.id);
    } finally {
      this.creating = false;
    }
  }
}
