import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import {
  applyUpdate,
  Doc as YDoc,
  encodeStateAsUpdate,
  encodeStateVector,
  Map as YMap,
} from 'yjs';

/**
 * Writes into a workspace's folder tree, the app's "Organize" folders.
 *
 * The tree is the app's `folders` table (modules/db/schema): one row per
 * folder or filed item, kept in the Yjs doc `db$<workspace>$folders` with each
 * row a top-level map keyed by its id (the ORM's Yjs table adapter). A folder
 * row is `{ type: 'folder', data: <name>, parentId }` (no parentId at the
 * top); a doc filed in one is `{ type: 'doc', data: <docId>, parentId }`.
 */

export const foldersDocId = (workspaceId: string) =>
  `db$${workspaceId}$folders`;

const DELETED = '$$DELETED';

interface Row {
  id: string;
  parentId: string | null;
  type: string;
  data: string;
  index: string;
}

const RANDOM_SIZE = 32;
const POSTFIX_CHARS =
  '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * An order key after `last`, in the app's format (a fractional-indexing key,
 * '0', then 32 random characters), so moving the item in the app later works
 * as for one made there.
 */
export function indexAfter(last: string | null): string {
  const subkey =
    last === null
      ? null
      : last.length <= RANDOM_SIZE + 1
        ? last
        : last.slice(0, last.length - RANDOM_SIZE - 1);
  let postfix = '';
  for (let i = 0; i < RANDOM_SIZE; i++) {
    postfix += POSTFIX_CHARS[Math.floor(Math.random() * POSTFIX_CHARS.length)];
  }
  return generateKeyBetween(subkey, null) + '0' + postfix;
}

function readRows(doc: YDoc): Row[] {
  const rows: Row[] = [];
  for (const key of doc.share.keys()) {
    const map = doc.getMap(key) as YMap<unknown>;
    if (map.size === 0 || map.get(DELETED) === true) continue;
    rows.push({
      id: String(map.get('id') ?? key),
      parentId: (map.get('parentId') as string | null | undefined) ?? null,
      type: String(map.get('type') ?? ''),
      data: String(map.get('data') ?? ''),
      index: String(map.get('index') ?? ''),
    });
  }
  return rows;
}

function lastIndex(rows: Row[], parentId: string | null): string | null {
  const indexes = rows
    .filter(row => row.parentId === parentId && row.index)
    .map(row => row.index)
    .sort();
  return indexes.length ? indexes[indexes.length - 1] : null;
}

function insertRow(doc: YDoc, rows: Row[], row: Omit<Row, 'id' | 'index'>) {
  const id = nanoid();
  const index = indexAfter(lastIndex(rows, row.parentId));
  const map = doc.getMap(id);
  map.set('id', id);
  if (row.parentId !== null) map.set('parentId', row.parentId);
  map.set('type', row.type);
  map.set('data', row.data);
  map.set('index', index);
  const created = { ...row, id, index };
  rows.push(created);
  return created;
}

/**
 * File `docId` under the folder `path` (outermost first), making any folder
 * on the way that doesn't exist. Folders match by name under their parent, so
 * filing again reuses them; a doc already in that folder isn't added twice.
 *
 * Returns the Yjs update to push to `db$<workspace>$folders` (empty when
 * nothing changed) and the folder the doc is in.
 */
export function fileDocInFolders(
  existing: Uint8Array,
  path: string[],
  docId: string
): { update: Uint8Array; folderId: string } {
  const names = path.map(name => name.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('folder path is empty');

  const doc = new YDoc();
  if (existing.length > 0) applyUpdate(doc, existing);
  const before = encodeStateVector(doc);
  const rows = readRows(doc);

  let folderId = '';
  doc.transact(() => {
    let parentId: string | null = null;
    for (const name of names) {
      const found = rows
        .filter(
          row =>
            row.type === 'folder' &&
            row.parentId === parentId &&
            row.data === name
        )
        .sort((a, b) => (a.index < b.index ? -1 : 1))[0];
      parentId = (
        found ?? insertRow(doc, rows, { parentId, type: 'folder', data: name })
      ).id;
    }
    const filed = rows.some(
      row =>
        row.type === 'doc' && row.parentId === parentId && row.data === docId
    );
    if (!filed) insertRow(doc, rows, { parentId, type: 'doc', data: docId });
    folderId = parentId as string;
  });

  return { update: encodeStateAsUpdate(doc, before), folderId };
}
