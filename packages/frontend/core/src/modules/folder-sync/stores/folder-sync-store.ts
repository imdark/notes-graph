import { Store } from '@notesgraph/infra';
import { type IDBPDatabase, openDB } from 'idb';

const DB_NAME = 'notesgraph-folder-sync';
const DB_VERSION = 1;
const BINDINGS = 'bindings';
const ENTRIES = 'entries';

/** A folder the user has bound to a workspace. */
export interface FolderBinding {
  /** `${workspaceId}` — one bound folder per workspace for now. */
  workspaceId: string;
  /**
   * The live handle. Stored directly: `FileSystemDirectoryHandle` is
   * structured-cloneable, which is why this store is IndexedDB and not the
   * localStorage-backed GlobalState (JSON would reduce it to `{}`).
   *
   * The handle survives reloads but its *permission* does not — the browser
   * requires a fresh user gesture to re-grant, so a binding can exist while
   * being temporarily unusable. See `FolderSyncService.ensurePermission`.
   */
  handle: FileSystemDirectoryHandle;
  folderName: string;
  boundAt: number;
}

/**
 * One synced file. `filePath` is relative to the bound root, POSIX-separated.
 *
 * The two hashes are the loop breaker: they record what each side looked like
 * at the last sync, so we can tell "the file changed", "the note changed" and
 * "both changed" (a conflict) apart from "we are seeing the echo of our own
 * write".
 */
export interface FolderSyncEntry {
  /** `${workspaceId}:${filePath}` */
  key: string;
  workspaceId: string;
  filePath: string;
  docId: string;
  /** Hash of the file's markdown as of the last sync. */
  fileHash: string;
  /** Hash of the markdown exported from the note as of the last sync. */
  docHash: string;
  lastSyncedAt: number;
}

/**
 * Local, per-device persistence for folder bindings.
 *
 * Deliberately NOT the workspace DB: a directory handle is meaningful only on
 * the machine that granted it, and syncing one to other devices (or the
 * server) would be both useless and a privacy leak. It is also not
 * `CacheStorage`, which is documented as clearable at any time — losing a
 * binding would silently strand the folder.
 */
export class FolderSyncStore extends Store {
  private db: IDBPDatabase<any> | null = null;

  private async getDB() {
    if (!this.db) {
      this.db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(BINDINGS)) {
            db.createObjectStore(BINDINGS, { keyPath: 'workspaceId' });
          }
          if (!db.objectStoreNames.contains(ENTRIES)) {
            const store = db.createObjectStore(ENTRIES, { keyPath: 'key' });
            store.createIndex('workspaceId', 'workspaceId');
            store.createIndex('docId', 'docId');
          }
        },
      });
    }
    return this.db;
  }

  async getBinding(workspaceId: string): Promise<FolderBinding | undefined> {
    const db = await this.getDB();
    return db.get(BINDINGS, workspaceId);
  }

  async setBinding(binding: FolderBinding): Promise<void> {
    const db = await this.getDB();
    await db.put(BINDINGS, binding);
  }

  async removeBinding(workspaceId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(BINDINGS, workspaceId);
    await this.clearEntries(workspaceId);
  }

  async listEntries(workspaceId: string): Promise<FolderSyncEntry[]> {
    const db = await this.getDB();
    return db.getAllFromIndex(ENTRIES, 'workspaceId', workspaceId);
  }

  async getEntry(
    workspaceId: string,
    filePath: string
  ): Promise<FolderSyncEntry | undefined> {
    const db = await this.getDB();
    return db.get(ENTRIES, `${workspaceId}:${filePath}`);
  }

  async findEntryByDocId(
    workspaceId: string,
    docId: string
  ): Promise<FolderSyncEntry | undefined> {
    const db = await this.getDB();
    const matches: FolderSyncEntry[] = await db.getAllFromIndex(
      ENTRIES,
      'docId',
      docId
    );
    return matches.find(entry => entry.workspaceId === workspaceId);
  }

  async putEntry(entry: Omit<FolderSyncEntry, 'key'>): Promise<void> {
    const db = await this.getDB();
    await db.put(ENTRIES, {
      ...entry,
      key: `${entry.workspaceId}:${entry.filePath}`,
    });
  }

  async removeEntry(workspaceId: string, filePath: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(ENTRIES, `${workspaceId}:${filePath}`);
  }

  async clearEntries(workspaceId: string): Promise<void> {
    const db = await this.getDB();
    const entries = await this.listEntries(workspaceId);
    const tx = db.transaction(ENTRIES, 'readwrite');
    await Promise.all([
      ...entries.map(entry => tx.store.delete(entry.key)),
      tx.done,
    ]);
  }
}
