import { MarkdownTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';
import { LiveData, Service } from '@notesgraph/infra';
import { debounceTime, Subject, Subscription } from 'rxjs';

import { getStoreManager } from '../../../blocksuite/manager/store';
import type { DocsService } from '../../doc';
import {
  getNotesGraphWorkspaceSchema,
  type WorkspaceService,
} from '../../workspace';
import type { FolderSyncStore } from '../stores/folder-sync-store';
import {
  deleteFileAt,
  ensurePermission,
  type FolderWatch,
  hasNativeFileObserver,
  isFolderSyncSupported,
  observeFolder,
  pickFolder,
  readFileAt,
  walkMarkdownFiles,
  writeFileAt,
} from '../utils/fs-access';
import {
  fileNameForTitle,
  hashText,
  readDocId,
  stampDocId,
  stripDocId,
  titleFromFileName,
} from '../utils/markdown-file';

export type FolderSyncState =
  | { state: 'unsupported' }
  | { state: 'unbound' }
  /** Bound, but the browser needs a user gesture to re-grant permission. */
  | { state: 'needs-permission'; folderName: string }
  | { state: 'syncing'; folderName: string; progress: string }
  | {
      state: 'watching';
      folderName: string;
      fileCount: number;
      live: boolean;
      conflicts: number;
    }
  | { state: 'error'; message: string };

/** Debounce on note edits before writing to disk, so typing isn't a write storm. */
const DOC_WRITE_DEBOUNCE_MS = 1500;

/**
 * Keeps a local folder of markdown files and a workspace's notes in step, in
 * both directions, for as long as the tab is open.
 *
 * ## How a loop is avoided
 *
 * Every sync path is gated on a content hash recorded at the last sync
 * (`fileHash` / `docHash` on the entry). Writing a file fires the folder
 * observer; importing that file edits the note; editing the note schedules a
 * file write. Without the gate that is a permanent cycle. So: before writing
 * either side, compare the new content's hash against what we last wrote, and
 * do nothing when they match.
 *
 * ## Conflicts
 *
 * If both sides changed since the last sync, neither version is thrown away:
 * the note's version is written beside the file as `<name>.conflict-<ts>.md`
 * and the file on disk wins for the note's content. Losing a user's writing to
 * a silent last-writer-wins is the one outcome worth going out of the way to
 * prevent.
 *
 * ## Scope
 *
 * Markdown only, and lossy by nature — edgeless surfaces, block-level
 * properties and comments have no markdown representation and will not
 * survive a round trip. Only notes bound to a file are ever exported.
 */
export class FolderSyncService extends Service {
  readonly status$ = new LiveData<FolderSyncState>(
    isFolderSyncSupported() ? { state: 'unbound' } : { state: 'unsupported' }
  );

  private watch: FolderWatch | null = null;
  private handle: FileSystemDirectoryHandle | null = null;
  private conflicts = 0;

  /** One `updatedAt$` watcher per note, reconciled as the note list changes. */
  private readonly docWatchers = new Map<string, Subscription>();
  private docEditsWatched = false;

  /** Notes whose edits still need writing out, coalesced. */
  private readonly dirtyDocs$ = new Subject<string>();
  private readonly subscriptions = new Subscription();

  /**
   * Paths this service is writing right now. The observer fires on our own
   * writes too, and the hash gate catches that a moment later — this just
   * avoids the pointless re-read in the common case.
   */
  private readonly writing = new Set<string>();

  constructor(
    private readonly store: FolderSyncStore,
    private readonly workspaceService: WorkspaceService,
    private readonly docsService: DocsService
  ) {
    super();

    this.subscriptions.add(
      this.dirtyDocs$
        .pipe(debounceTime(DOC_WRITE_DEBOUNCE_MS))
        .subscribe(docId => {
          void this.syncDocToFile(docId).catch(() => {
            /* reported through status$ */
          });
        })
    );
  }

  private get workspaceId() {
    return this.workspaceService.workspace.id;
  }

  // ---- binding ----------------------------------------------------------

  /** Prompt for a folder and start syncing it. Must run in a user gesture. */
  async bind(): Promise<boolean> {
    if (!isFolderSyncSupported()) {
      this.status$.next({ state: 'unsupported' });
      return false;
    }
    const handle = await pickFolder();
    if (!handle) return false;

    await this.store.setBinding({
      workspaceId: this.workspaceId,
      handle,
      folderName: handle.name,
      boundAt: Date.now(),
    });
    this.handle = handle;
    await this.startSync(handle);
    return true;
  }

  /**
   * Re-attach to a previously bound folder on startup.
   *
   * Returns false when the handle is still there but unusable without a user
   * gesture — the caller should surface a "reconnect" affordance rather than
   * treating it as unbound.
   */
  async resume(): Promise<boolean> {
    if (!isFolderSyncSupported()) {
      this.status$.next({ state: 'unsupported' });
      return false;
    }
    const binding = await this.store.getBinding(this.workspaceId);
    if (!binding) {
      this.status$.next({ state: 'unbound' });
      return false;
    }

    if (!(await ensurePermission(binding.handle))) {
      this.status$.next({
        state: 'needs-permission',
        folderName: binding.folderName,
      });
      return false;
    }

    this.handle = binding.handle;
    await this.startSync(binding.handle);
    return true;
  }

  /** Stop syncing and forget the folder. Files on disk are left alone. */
  async unbind(): Promise<void> {
    this.stopWatching();
    this.handle = null;
    await this.store.removeBinding(this.workspaceId);
    this.status$.next({ state: 'unbound' });
  }

  private stopWatching() {
    this.watch?.stop();
    this.watch = null;
    for (const subscription of this.docWatchers.values()) {
      subscription.unsubscribe();
    }
    this.docWatchers.clear();
    this.docEditsWatched = false;
  }

  // ---- the sync loop ----------------------------------------------------

  private async startSync(handle: FileSystemDirectoryHandle) {
    this.stopWatching();
    this.conflicts = 0;

    try {
      this.status$.next({
        state: 'syncing',
        folderName: handle.name,
        progress: 'Scanning folder…',
      });

      const files = await walkMarkdownFiles(handle);
      let done = 0;
      for (const file of files) {
        await this.syncFileToDoc(file.path);
        done += 1;
        this.status$.next({
          state: 'syncing',
          folderName: handle.name,
          progress: `Imported ${done}/${files.length}`,
        });
      }

      this.watch = observeFolder(handle, paths => {
        for (const path of paths) {
          if (this.writing.has(path)) continue;
          void this.syncFileToDoc(path).catch(() => {
            /* reported through status$ */
          });
        }
      });

      this.watchDocEdits();

      this.status$.next({
        state: 'watching',
        folderName: handle.name,
        fileCount: files.length,
        live: this.watch.live && hasNativeFileObserver(),
        conflicts: this.conflicts,
      });
    } catch (err) {
      this.status$.next({
        state: 'error',
        message: err instanceof Error ? err.message : 'Folder sync failed',
      });
    }
  }

  /**
   * Queue a file write whenever a synced note is edited.
   *
   * `updatedAt$` is the signal because it now means "a local transaction
   * touched this note" and nothing else — system writes that used to bump it
   * spuriously were fixed in `writeSiteManifest`. If that regresses, this
   * becomes a write storm, so it is worth knowing the two are linked.
   */
  private watchDocEdits() {
    if (this.docEditsWatched) return;
    this.docEditsWatched = true;

    // Reconcile rather than re-subscribe: `docs$` re-emits on any change to
    // the list, so subscribing to every record's `updatedAt$` per emission
    // would add a duplicate watcher for all of them each time and never drop
    // the old ones — unbounded growth, and N duplicate writes per edit.
    this.subscriptions.add(
      this.docsService.list.docs$.subscribe(records => {
        const live = new Set(records.map(record => record.id));

        for (const [docId, subscription] of this.docWatchers) {
          if (!live.has(docId)) {
            subscription.unsubscribe();
            this.docWatchers.delete(docId);
          }
        }

        for (const record of records) {
          if (this.docWatchers.has(record.id)) continue;
          this.docWatchers.set(
            record.id,
            record.updatedAt$.subscribe(() => {
              void this.store
                .findEntryByDocId(this.workspaceId, record.id)
                .then(entry => {
                  if (entry) this.dirtyDocs$.next(record.id);
                });
            })
          );
        }
      })
    );
  }

  // ---- file -> note -----------------------------------------------------

  private async syncFileToDoc(path: string): Promise<void> {
    const handle = this.handle;
    if (!handle) return;

    const raw = await readFileAt(handle, path);
    const entry = await this.store.getEntry(this.workspaceId, path);

    // Deleted on disk: drop the mapping but keep the note. Deleting a user's
    // note because a file vanished (a move we mis-read, a sync client, a
    // stray rm) is not a trade worth making.
    if (raw === null) {
      if (entry) await this.store.removeEntry(this.workspaceId, path);
      return;
    }

    const fileHash = await hashText(raw);
    if (entry && entry.fileHash === fileHash) return; // our own echo

    const body = stripDocId(raw);
    const stampedId = readDocId(raw);
    const docId = stampedId ?? entry?.docId ?? null;

    if (docId && this.docsService.list.doc$(docId).value) {
      await this.replaceDocContent(docId, body, path, fileHash, entry?.docHash);
      return;
    }

    // No note yet for this file: create one, then stamp its id into the file
    // so the pairing survives renames and re-binds.
    const newDocId = await MarkdownTransformer.importMarkdownToDoc({
      collection: this.workspaceService.workspace.docCollection,
      schema: getNotesGraphWorkspaceSchema(),
      markdown: body,
      fileName: titleFromFileName(path.split('/').pop() ?? path),
      extensions: getStoreManager().config.init().value.get('store'),
    });
    if (!newDocId) return;

    const stamped = stampDocId(raw, newDocId);
    await this.writeFile(path, stamped);

    await this.store.putEntry({
      workspaceId: this.workspaceId,
      filePath: path,
      docId: newDocId,
      fileHash: await hashText(stamped),
      docHash: await this.hashDoc(newDocId),
      lastSyncedAt: Date.now(),
    });
  }

  /**
   * Replace a note's body with `markdown`.
   *
   * Full replace rather than a merge: markdown carries no block identity, so
   * there is nothing to diff against. Block ids are therefore not stable
   * across a file-driven update, which is why comments and block references
   * are called out as not surviving a round trip.
   */
  private async replaceDocContent(
    docId: string,
    markdown: string,
    path: string,
    fileHash: string,
    lastDocHash: string | undefined
  ): Promise<void> {
    const currentDocHash = await this.hashDoc(docId);

    // Both sides moved since the last sync: preserve the note's version on
    // disk before the file overwrites it.
    if (lastDocHash !== undefined && currentDocHash !== lastDocHash) {
      const current = await this.exportDoc(docId);
      if (current) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await this.writeFile(
          path.replace(/\.mdx?$/i, `.conflict-${stamp}.md`),
          current
        );
        this.conflicts += 1;
      }
    }

    const { doc, release } = this.docsService.open(docId);
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const note = store.getBlocksByFlavour('affine:note')[0];
      if (!note) return;

      store.transact(() => {
        for (const child of [...note.model.children]) {
          store.deleteBlock(child);
        }
      });

      await MarkdownTransformer.importMarkdownToBlock({
        doc: store,
        markdown,
        blockId: note.id,
        extensions: getStoreManager().config.init().value.get('store'),
      });
    } finally {
      release();
    }

    await this.store.putEntry({
      workspaceId: this.workspaceId,
      filePath: path,
      docId,
      fileHash,
      docHash: await this.hashDoc(docId),
      lastSyncedAt: Date.now(),
    });
  }

  // ---- note -> file -----------------------------------------------------

  private async syncDocToFile(docId: string): Promise<void> {
    const handle = this.handle;
    if (!handle) return;

    const entry = await this.store.findEntryByDocId(this.workspaceId, docId);
    if (!entry) return; // only notes that came from the folder are written back

    const markdown = await this.exportDoc(docId);
    if (markdown === null) return;

    const docHash = await hashText(markdown);
    if (docHash === entry.docHash) return; // nothing actually changed

    const stamped = stampDocId(markdown, docId);
    await this.writeFile(entry.filePath, stamped);

    await this.store.putEntry({
      ...entry,
      fileHash: await hashText(stamped),
      docHash,
      lastSyncedAt: Date.now(),
    });
  }

  /** Export a note to markdown, titled so the file reads naturally. */
  private async exportDoc(docId: string): Promise<string | null> {
    const { doc, release } = this.docsService.open(docId);
    try {
      await doc.waitForSyncReady();
      return await MarkdownTransformer.docToMarkdown(doc.blockSuiteDoc);
    } finally {
      release();
    }
  }

  private async hashDoc(docId: string): Promise<string> {
    const markdown = await this.exportDoc(docId);
    return markdown === null ? '' : await hashText(markdown);
  }

  private async writeFile(path: string, contents: string): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    this.writing.add(path);
    try {
      await writeFileAt(handle, path, contents);
    } finally {
      // Held past the write so the observer event it causes lands while the
      // path is still marked ours.
      setTimeout(() => this.writing.delete(path), 1000);
    }
  }

  // ---- exposed for the agent file tools ---------------------------------

  /** The bound root, or null when nothing is bound / permission lapsed. */
  get rootHandle(): FileSystemDirectoryHandle | null {
    return this.handle;
  }

  async listFiles(): Promise<string[]> {
    if (!this.handle) return [];
    return (await walkMarkdownFiles(this.handle)).map(f => f.path);
  }

  async readFile(path: string): Promise<string | null> {
    return this.handle ? readFileAt(this.handle, path) : null;
  }

  async writeFileFromAgent(path: string, contents: string): Promise<boolean> {
    if (!this.handle) return false;
    await this.writeFile(path, contents);
    // Pull the write straight back in so the note reflects it without waiting
    // for the observer.
    await this.syncFileToDoc(path);
    return true;
  }

  async deleteFile(path: string): Promise<boolean> {
    if (!this.handle) return false;
    const ok = await deleteFileAt(this.handle, path);
    if (ok) await this.store.removeEntry(this.workspaceId, path);
    return ok;
  }

  override dispose() {
    this.stopWatching();
    this.subscriptions.unsubscribe();
    super.dispose();
  }
}

/** A note's title, for naming a file the agent creates. */
export { fileNameForTitle };
