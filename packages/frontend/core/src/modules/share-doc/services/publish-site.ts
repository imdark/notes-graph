import { DebugLogger } from '@notesgraph/debug';
import { DocRole, PublicDocMode } from '@notesgraph/graphql';
import { LiveData, OnEvent, Service } from '@notesgraph/infra';
import {
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  type Observable,
  of,
  switchMap,
  timeout,
} from 'rxjs';

import type { DocsService } from '../../doc';
import type { DocsSearchService } from '../../docs-search';
import type { TagService } from '../../tag';
import { WorkspaceInitialized } from '../../workspace';
import type { WorkspaceService } from '../../workspace';
import type { Doc } from '../../doc';
import {
  DEFAULT_SITE_THEME,
  type PublishSiteSettings,
  SITE_DRAFT_TAG,
  type SiteManifest,
  type SiteManifestPage,
} from '../publish-site-types';
import {
  clearSiteData,
  readSiteManifest,
  writeSiteManifest,
} from '../site-manifest';
import type { ShareStore } from '../stores/share';

const logger = new DebugLogger('PublishSiteService');

/** Bounds so a pathological link graph can't publish forever. */
const MAX_SITE_PAGES = 500;
const MAX_DEPTH = 12;
/** How long to wait for the link index to answer one level of the subtree. */
const REFS_TIMEOUT_MS = 8000;

/**
 * "Publish a folder (a doc + its descendant notes) as a site."
 *
 * A folder = a root doc plus every note reachable from it through outgoing
 * links (its subtree in the note graph). Publishing bulk-publishes each note
 * via the existing per-doc publish, then writes a {@link SiteManifest} onto the
 * root doc's CRDT (and a back-pointer onto every descendant) so an anonymous
 * visitor can render the side-menu + theme — see {@link ../site-manifest}.
 *
 * Auto-publish: while a site is enabled, its subtree is watched and re-synced
 * so notes added under the folder are published (and removed ones revoked)
 * automatically.
 */
@OnEvent(WorkspaceInitialized, s => s.onWorkspaceInitialized)
export class PublishSiteService extends Service {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly docsService: DocsService,
    private readonly docsSearch: DocsSearchService,
    private readonly tagService: TagService,
    private readonly shareStore: ShareStore
  ) {
    super();
  }

  // ---- reactive state for the authoring UI ------------------------------

  /** Current site settings for a root doc, or null if never published. */
  siteSettings$(rootId: string): LiveData<PublishSiteSettings | null> {
    const rec = this.docsService.list.doc$(rootId).value;
    if (!rec) return new LiveData<PublishSiteSettings | null>(null);
    return rec.properties$.map(
      p => (p.publishSite as PublishSiteSettings | undefined) ?? null
    );
  }

  // ---- publish / unpublish / resync -------------------------------------

  /**
   * Publish `rootId` and its whole subtree as a site. Idempotent: re-running
   * re-publishes any new pages and rewrites the manifest. Returns the page
   * count so the UI can report "N pages published".
   */
  async publishSite(
    rootId: string,
    settings: PublishSiteSettings
  ): Promise<{ published: number }> {
    const wsId = this.workspaceService.workspace.id;
    const resolved: PublishSiteSettings = { ...settings, enabled: true };
    const pages = await this.enumerateSubtree(rootId);
    const manifest: SiteManifest = {
      version: 1,
      rootId,
      site: resolved,
      pages,
    };

    for (const page of pages) {
      try {
        await this.shareStore.enableSharePage(
          wsId,
          page.docId,
          PublicDocMode.Page,
          DocRole.Reader
        );
      } catch (err) {
        logger.error('failed to publish site page', page.docId, err);
      }
    }

    // Write the full manifest onto *every* page (not just the root) so a
    // visitor landing on any page renders the site shell from that page's own
    // binary — no second cross-doc fetch on the anonymous read path.
    for (const page of pages) {
      await this.withDoc(page.docId, doc =>
        writeSiteManifest(doc.yDoc, manifest)
      );
    }

    this.docsService.list
      .doc$(rootId)
      .value?.setProperty('publishSite', resolved);

    return { published: pages.length };
  }

  /**
   * Apply new settings (theme/title) to an already-published site without
   * re-enumerating or re-publishing pages — just rewrite the manifest + the
   * stored settings. Cheap enough to call on every theme tweak.
   */
  async updateSiteSettings(
    rootId: string,
    settings: PublishSiteSettings
  ): Promise<void> {
    const resolved: PublishSiteSettings = { ...settings, enabled: true };
    const existing = await this.withDoc(rootId, doc =>
      readSiteManifest(doc.yDoc)
    );
    const pages = existing?.pages ?? [];
    const manifest: SiteManifest = { version: 1, rootId, site: resolved, pages };
    // Rewrite the manifest on every page so the theme/title change reaches all
    // of them (each page self-describes the site).
    for (const page of pages.length ? pages : [{ docId: rootId }]) {
      await this.withDoc(page.docId, doc =>
        writeSiteManifest(doc.yDoc, manifest)
      );
    }
    this.docsService.list
      .doc$(rootId)
      .value?.setProperty('publishSite', resolved);
  }

  /** Revoke every page of the site and strip its manifest/pointers. */
  async unpublishSite(rootId: string): Promise<void> {
    const wsId = this.workspaceService.workspace.id;
    const manifest = await this.withDoc(rootId, doc =>
      readSiteManifest(doc.yDoc)
    );
    const pageIds = manifest?.pages.map(p => p.docId) ?? [rootId];

    for (const id of pageIds) {
      try {
        await this.shareStore.disableSharePage(wsId, id);
      } catch (err) {
        logger.error('failed to revoke site page', id, err);
      }
      await this.withDoc(id, doc => clearSiteData(doc.yDoc));
    }

    const rec = this.docsService.list.doc$(rootId).value;
    const current = rec?.properties$.value.publishSite as
      | PublishSiteSettings
      | undefined;
    if (rec && current) {
      rec.setProperty('publishSite', { ...current, enabled: false });
    }
  }

  /**
   * Re-publish the current subtree and revoke pages that dropped out of it.
   * Drives auto-publish when notes are added/removed under the folder.
   */
  async resyncSite(rootId: string): Promise<void> {
    const settings = this.currentSettings(rootId);
    if (!settings?.enabled) return;

    const prev = await this.withDoc(rootId, doc => readSiteManifest(doc.yDoc));
    const prevIds = new Set(prev?.pages.map(p => p.docId) ?? []);

    await this.publishSite(rootId, settings);

    const now = await this.withDoc(rootId, doc => readSiteManifest(doc.yDoc));
    const nowIds = new Set(now?.pages.map(p => p.docId) ?? []);

    for (const id of prevIds) {
      if (nowIds.has(id) || id === rootId) continue;
      try {
        await this.shareStore.disableSharePage(
          this.workspaceService.workspace.id,
          id
        );
      } catch (err) {
        logger.error('failed to revoke dropped page', id, err);
      }
      await this.withDoc(id, doc => clearSiteData(doc.yDoc));
    }
  }

  // ---- subtree enumeration ----------------------------------------------

  /**
   * BFS the outgoing-link subtree from `rootId`, capturing each page's title,
   * nearest in-site parent, and sibling order. Skips trashed and `#draft`
   * notes; cycle-guarded and bounded.
   */
  async enumerateSubtree(rootId: string): Promise<SiteManifestPage[]> {
    const rootRec = this.docsService.list.doc$(rootId).value;
    const pages: SiteManifestPage[] = [
      {
        docId: rootId,
        title: rootRec?.title$.value || 'Untitled',
        parentId: null,
        order: 0,
      },
    ];
    const visited = new Set<string>([rootId]);
    let frontier: string[] = [rootId];
    let depth = 0;

    while (
      frontier.length > 0 &&
      pages.length < MAX_SITE_PAGES &&
      depth++ < MAX_DEPTH
    ) {
      const next: string[] = [];
      for (const parentId of frontier) {
        let order = 0;
        for (const childId of await this.refsOf(parentId)) {
          if (visited.has(childId)) continue;
          visited.add(childId);
          const rec = this.docsService.list.doc$(childId).value;
          if (!rec || rec.trash$.value || this.isDraft(childId)) continue;
          if (pages.length >= MAX_SITE_PAGES) break;
          pages.push({
            docId: childId,
            title: rec.title$.value || 'Untitled',
            parentId,
            order: order++,
          });
          next.push(childId);
        }
      }
      frontier = next;
    }

    return pages;
  }

  private async refsOf(docId: string): Promise<string[]> {
    try {
      const refs = await firstValueFrom(
        this.docsSearch
          .watchRefsFrom(docId)
          .pipe(timeout({ first: REFS_TIMEOUT_MS }))
      );
      return refs.map(r => r.docId);
    } catch {
      return [];
    }
  }

  private isDraft(docId: string): boolean {
    const tags = this.tagService.tagList.tagsByPageId$(docId).value;
    return tags.some(t => t.value$.value.trim().toLowerCase() === SITE_DRAFT_TAG);
  }

  // ---- auto-publish glue -------------------------------------------------

  onWorkspaceInitialized() {
    // Publishing needs the cloud backend; the throwaway anonymous share
    // workspace must never try to (re)publish.
    if (this.workspaceService.workspace.openOptions.isSharedMode) return;

    const enabledRoots$ = this.docsService
      .propertyValues$('publishSite')
      .pipe(
        map(values => {
          const roots: string[] = [];
          for (const [docId, raw] of values) {
            if (this.parseSettings(raw)?.enabled) roots.push(docId);
          }
          return roots;
        }),
        distinctUntilChanged(
          (a, b) => a.length === b.length && a.every(x => b.includes(x))
        )
      );

    const subscription = enabledRoots$
      .pipe(
        switchMap(roots =>
          roots.length === 0
            ? of([] as string[][])
            : combineLatest(
                roots.map(rootId => this.descendants$(rootId))
              )
        )
      )
      .subscribe(() => {
        // Membership of some site changed — re-sync every enabled site.
        for (const rootId of this.currentEnabledRoots()) {
          void this.resyncSite(rootId).catch(err =>
            logger.error('auto-resync failed', rootId, err)
          );
        }
      });

    this.disposables.push(() => subscription.unsubscribe());
  }

  /** Reactive descendant-id set of a root; re-emits when any link changes. */
  private descendants$(rootId: string): Observable<string[]> {
    const expand = (ids: string[], depth: number): Observable<string[]> => {
      if (depth <= 0) return of(ids);
      return this.docsSearch.watchRefsFrom(ids).pipe(
        switchMap(refs => {
          const childIds = refs
            .map(r => r.docId)
            .filter(id => !ids.includes(id));
          return childIds.length === 0
            ? of(ids)
            : expand([...ids, ...childIds], depth - 1);
        })
      );
    };
    return expand([rootId], MAX_DEPTH).pipe(
      distinctUntilChanged(
        (a, b) => a.length === b.length && a.every(x => b.includes(x))
      )
    );
  }

  private currentEnabledRoots(): string[] {
    const roots: string[] = [];
    for (const rec of this.docsService.list.docs$.value) {
      const s = rec.properties$.value.publishSite as
        | PublishSiteSettings
        | undefined;
      if (s?.enabled) roots.push(rec.id);
    }
    return roots;
  }

  private currentSettings(rootId: string): PublishSiteSettings | undefined {
    return this.docsService.list.doc$(rootId).value?.properties$.value
      .publishSite as PublishSiteSettings | undefined;
  }

  private parseSettings(raw: unknown): PublishSiteSettings | null {
    if (!raw) return null;
    if (typeof raw === 'object') return raw as PublishSiteSettings;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as PublishSiteSettings;
      } catch {
        return null;
      }
    }
    return null;
  }

  // ---- helpers -----------------------------------------------------------

  /** Open a doc, wait for sync, run `fn` against its CRDT, then release. */
  private async withDoc<T>(
    docId: string,
    fn: (doc: Doc) => T
  ): Promise<T | undefined> {
    if (!this.docsService.list.doc$(docId).value) return undefined;
    const { doc, release } = this.docsService.open(docId);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    try {
      await doc.waitForSyncReady();
      return fn(doc);
    } catch (err) {
      logger.error('withDoc failed', docId, err);
      return undefined;
    } finally {
      disposePriorityLoad();
      release();
    }
  }
}

export { DEFAULT_SITE_THEME };
