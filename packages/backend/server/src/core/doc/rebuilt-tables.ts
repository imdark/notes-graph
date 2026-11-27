import {
  applyUpdate,
  decodeStateVector,
  Doc,
  encodeStateAsUpdate,
  encodeStateVectorFromUpdate,
} from 'yjs';

/**
 * Workspace tables moved to a fresh doc to shed their history.
 *
 * A table doc (`db$<workspace>$<table>`) keeps a tombstone for every value
 * ever overwritten. `docProperties` had `updatedBy` rewritten every second of
 * typing: 1.25 MB, 94% of it tombstones, merged in full on each write. It
 * can't be cleaned in place, since any client holding the old doc syncs the
 * history back, so the app reads and writes a new doc and the server copies
 * the live rows into it once.
 *
 * new table doc name -> the doc it was rebuilt from. The app's side of this
 * map is `modules/db/storage-names.ts`.
 */
const REBUILT_FROM: Record<string, string> = {
  docProperties2: 'docProperties',
};

/**
 * The yjs client the copy is written as. A fixed id makes the copy detectable
 * (it is in the doc's state vector once applied), and the lowest one makes it
 * lose: when a client has already written a field, both writes are first for
 * that key, yjs orders them by client id, and the higher id is the value.
 */
export const SEED_CLIENT_ID = 1;

const DELETED_FLAG = '$$DELETED';

/** For a rebuilt table's doc id, the id of the doc its rows come from. */
export function rebuiltTableSource(
  workspaceId: string,
  docId: string
): string | null {
  const prefix = `db$${workspaceId}$`;
  if (!docId.startsWith(prefix)) {
    return null;
  }
  const source = REBUILT_FROM[docId.slice(prefix.length)];
  return source ? `${prefix}${source}` : null;
}

/** The doc ids of every rebuilt table of a workspace. */
export function rebuiltTableDocIds(workspaceId: string): string[] {
  return Object.keys(REBUILT_FROM).map(name => `db$${workspaceId}$${name}`);
}

/** Whether the copy has been applied to this doc. */
export function isSeeded(bin: Uint8Array): boolean {
  return decodeStateVector(encodeStateVectorFromUpdate(bin)).has(
    SEED_CLIENT_ID
  );
}

/**
 * The live rows of a table doc as one update from `SEED_CLIENT_ID`: no
 * tombstones, no deleted rows. Null when there is nothing to copy.
 *
 * Rows are root-level maps keyed by the row's id (the ORM's YjsTableAdapter).
 */
export function buildSeed(source: Uint8Array): Uint8Array | null {
  const from = new Doc();
  applyUpdate(from, source);

  const seed = new Doc();
  seed.clientID = SEED_CLIENT_ID;
  let rows = 0;
  seed.transact(() => {
    for (const key of [...from.share.keys()].sort()) {
      const row = from.getMap(key);
      if (row.size === 0 || row.get(DELETED_FLAG) === true) {
        continue;
      }
      const copy = seed.getMap(key);
      for (const field of [...row.keys()].sort()) {
        const value = row.get(field);
        if (value !== undefined) {
          copy.set(field, value);
        }
      }
      rows++;
    }
  });

  return rows > 0 ? encodeStateAsUpdate(seed) : null;
}

/** What the seeder needs of doc storage. */
export interface SeedStorage {
  /** The doc with its pending updates merged in, or null when it has none. */
  getDoc(
    workspaceId: string,
    docId: string
  ): Promise<{ bin: Uint8Array } | null>;
  pushDocUpdates(
    workspaceId: string,
    docId: string,
    updates: Uint8Array[]
  ): Promise<unknown>;
  /** Held while one doc is checked and seeded, across server processes. */
  lock(workspaceId: string, docId: string): Promise<AsyncDisposable>;
}

/**
 * Copies a rebuilt table's rows in from its source doc, once per workspace,
 * before the table is first read. `ensure` is called ahead of every read of a
 * doc and returns at once for any other doc, and for one already dealt with.
 *
 * The copy is pushed as an ordinary update, so it merges with whatever
 * clients have already written to the new doc.
 */
export class RebuiltTableSeeder {
  /** Docs seeded, or with nothing to copy, as far as this process knows. */
  private readonly settled = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: SeedStorage,
    private readonly log: (message: string) => void = () => {}
  ) {}

  async ensure(workspaceId: string, docId: string): Promise<void> {
    const source = rebuiltTableSource(workspaceId, docId);
    if (!source) {
      return;
    }
    const key = `${workspaceId}/${docId}`;
    if (this.settled.has(key)) {
      return;
    }

    let run = this.running.get(key);
    if (!run) {
      run = this.seed(workspaceId, docId, source)
        .then(() => {
          this.settled.add(key);
        })
        .finally(() => {
          this.running.delete(key);
        });
      this.running.set(key, run);
    }
    await run;
  }

  private async seed(workspaceId: string, docId: string, source: string) {
    await using _lock = await this.storage.lock(workspaceId, `${docId}:seed`);

    const current = await this.storage.getDoc(workspaceId, docId);
    if (current && isSeeded(current.bin)) {
      return;
    }
    const from = await this.storage.getDoc(workspaceId, source);
    const seed = from ? buildSeed(from.bin) : null;
    if (!seed) {
      return;
    }
    await this.storage.pushDocUpdates(workspaceId, docId, [seed]);
    this.log(
      `Seeded ${docId} from ${source}: ${from?.bin.byteLength} bytes of history down to ${seed.byteLength}`
    );
  }
}
