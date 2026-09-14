import { DatabaseSync } from 'node:sqlite';

import * as Y from 'yjs';

export interface DocMeta {
  id: string;
  title: string;
  trash?: boolean;
  createDate?: number;
  updatedDate?: number;
}

/**
 * Where doc bytes come from and go. A `local` transport reads the offline
 * nbstore SQLite; a `remote` transport talks to the live server API. The
 * shared notes layer only depends on this interface.
 */
export interface Transport {
  readonly kind: 'local' | 'remote';
  listDocMetas(): Promise<DocMeta[]>;
  /** Merged Yjs state for a doc, or null if it isn't present. */
  getDocBin(docId: string): Promise<Uint8Array | null>;
  /** Persist a Yjs update for a doc (edit/connect). */
  pushUpdate(docId: string, update: Uint8Array): Promise<void>;
  /** Create a note from markdown; returns the new doc id. Live backend only. */
  createNote?(title: string, markdown: string): Promise<string>;
  /** Replace a note's body with new markdown. Live backend only. */
  editNote?(docId: string, markdown: string): Promise<void>;
  close?(): void;
}

/** Parse a workspace root doc's binary into its doc list (`meta.pages`). */
export function parseDocList(bin: Uint8Array): DocMeta[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bin);
  const pages = doc.getMap('meta').get('pages');
  const arr =
    pages instanceof Y.Array
      ? pages.toArray()
      : Array.isArray(pages)
        ? pages
        : [];
  return arr
    .map((p): DocMeta => {
      const get = (k: string) =>
        p instanceof Y.Map ? p.get(k) : (p as Record<string, unknown>)?.[k];
      return {
        id: String(get('id') ?? ''),
        title: String(get('title') ?? ''),
        trash: !!get('trash'),
        createDate: Number(get('createDate')) || undefined,
        updatedDate: Number(get('updatedDate')) || undefined,
      };
    })
    .filter(d => d.id && !d.trash);
}

/** Reads/writes the desktop app's nbstore SQLite directly (offline). */
export class LocalTransport implements Transport {
  readonly kind = 'local';
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
  }

  private workspaceId(): string {
    const row = this.db.prepare('SELECT space_id FROM meta LIMIT 1').get() as
      | { space_id?: string }
      | undefined;
    if (!row?.space_id) {
      throw new Error('No workspace found in this database');
    }
    return row.space_id;
  }

  private mergedBin(docId: string): Uint8Array | null {
    const snap = this.db
      .prepare('SELECT data FROM snapshots WHERE doc_id = ?')
      .get(docId) as { data?: Uint8Array } | undefined;
    const updates = this.db
      .prepare('SELECT data FROM updates WHERE doc_id = ? ORDER BY created_at')
      .all(docId) as Array<{ data: Uint8Array }>;
    const parts: Uint8Array[] = [];
    if (snap?.data) parts.push(new Uint8Array(snap.data));
    for (const u of updates) parts.push(new Uint8Array(u.data));
    return parts.length ? Y.mergeUpdates(parts) : null;
  }

  async getDocBin(docId: string): Promise<Uint8Array | null> {
    return this.mergedBin(docId);
  }

  async listDocMetas(): Promise<DocMeta[]> {
    const bin = this.mergedBin(this.workspaceId());
    return bin ? parseDocList(bin) : [];
  }

  async pushUpdate(docId: string, update: Uint8Array): Promise<void> {
    this.db
      .prepare('INSERT INTO updates (doc_id, created_at, data) VALUES (?, ?, ?)')
      .run(docId, Date.now(), update);
  }

  close() {
    this.db.close();
  }
}
