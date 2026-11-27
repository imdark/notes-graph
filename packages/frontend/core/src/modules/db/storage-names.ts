/**
 * The storage doc a workspace table lives in, when that isn't the table's own
 * name.
 *
 * A table's doc keeps a tombstone for every value ever overwritten, and a doc
 * can't be cleaned in place: any device holding the old one syncs the history
 * back. So a table that has outgrown its history is moved to a fresh doc, and
 * the server copies the live rows into it once, the first time the new doc is
 * read (`core/doc/rebuilt-tables.ts` on the server, which holds the other
 * side of this map).
 *
 * `docProperties` had `updatedBy` rewritten every second of typing: 1.25 MB,
 * 94% of it tombstones, merged in full by the server on each write.
 *
 * Only cloud workspaces move. A local workspace has no server to do the copy,
 * so its tables stay where they are.
 */
const REBUILT_TABLE_DOCS: Record<string, string> = {
  docProperties: 'docProperties2',
};

/** The name a table is stored under: its doc is `db$<name>`. */
export function tableStorageName(tableName: string, cloud: boolean): string {
  return (cloud && REBUILT_TABLE_DOCS[tableName]) || tableName;
}
