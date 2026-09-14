// Minimal ambient types for Node's built-in SQLite (experimental; not yet in
// @types/node 22). Only what this tool uses.
declare module 'node:sqlite' {
  interface Statement {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): Statement;
    close(): void;
  }
}
