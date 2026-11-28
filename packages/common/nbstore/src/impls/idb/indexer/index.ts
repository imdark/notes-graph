import { merge, Observable, of, Subject, throttleTime } from 'rxjs';

import { recordLoadEvent, share } from '../../../connection';
import type {
  AggregateOptions,
  AggregateResult,
  IndexerDocument,
  IndexerSchema,
  Query,
  SearchOptions,
  SearchResult,
} from '../../../storage';
import { IndexerStorageBase } from '../../../storage';
import { fromPromise } from '../../../utils/from-promise';
import { IDBConnection, type IDBConnectionOptions } from '../db';
import { DataStruct } from './data-struct';
import { backoffRetry, exhaustMapWithTrailing } from './utils';

/** An index read or write this slow goes in the load log. */
const SLOW_INDEXER_MS = 1000;

/**
 * Times one index operation. IndexedDB serves a site's requests one after
 * another, so a long query or write here holds up every other read of the
 * workspace's data, in every tab: a note opened meanwhile waits behind it.
 */
async function timed<T>(
  op: string,
  table: string,
  detail: () => Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    const ms = Date.now() - started;
    if (ms >= SLOW_INDEXER_MS) {
      recordLoadEvent('indexer-slow', { op, table, ms, ...detail() });
    }
  }
}

const brief = (value: unknown) => {
  try {
    return JSON.stringify(value)?.slice(0, 300);
  } catch {
    return undefined;
  }
};

export class IndexedDBIndexerStorage extends IndexerStorageBase {
  static readonly identifier = 'IndexedDBIndexerStorage';
  override recommendRefreshInterval: number = 0; // force refresh on each indexer operation
  readonly connection = share(new IDBConnection(this.options));
  override isReadonly = false;
  private readonly data = new DataStruct();
  private readonly tableUpdate$ = new Subject<string>();

  /**
   * The write operations of IndexedDBIndexerStorage are first cached in pendingUpdates,
   * and then committed to IndexedDB in a batch through the refresh method.
   */
  private readonly pendingUpdates: Record<
    keyof IndexerSchema,
    {
      deleteByQueries: Query<any>[];
      deletes: string[];
      inserts: IndexerDocument[];
      updates: IndexerDocument[];
    }
  > = {
    doc: { deleteByQueries: [], deletes: [], inserts: [], updates: [] },
    block: { deleteByQueries: [], deletes: [], inserts: [], updates: [] },
  };

  get channel() {
    return this.connection.inner.channel;
  }

  get database() {
    return this.connection.inner.db;
  }

  constructor(private readonly options: IDBConnectionOptions) {
    super();
  }

  override async search<
    T extends keyof IndexerSchema,
    const O extends SearchOptions<T>,
  >(table: T, query: Query<T>, options?: O): Promise<SearchResult<T, O>> {
    return timed(
      'search',
      table,
      () => ({ query: brief(query) }),
      async () => {
        const cache = await this.prefetchExists(table, query);
        const trx = await this.data.readonly(this.database);
        return this.data.search(trx, table, query, options, cache);
      }
    );
  }
  override async aggregate<
    T extends keyof IndexerSchema,
    const O extends AggregateOptions<T>,
  >(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O
  ): Promise<AggregateResult<T, O>> {
    return timed(
      'aggregate',
      table,
      () => ({ query: brief(query), field }),
      async () => {
        const cache = await this.prefetchExists(table, query);
        const trx = await this.data.readonly(this.database);
        return this.data.aggregate(
          trx,
          table,
          query,
          field as string,
          options,
          cache
        );
      }
    );
  }
  override search$<
    T extends keyof IndexerSchema,
    const O extends SearchOptions<T>,
  >(table: T, query: Query<T>, options?: O): Observable<SearchResult<T, O>> {
    return merge(of(1), this.watchTableUpdated(table)).pipe(
      throttleTime(3000, undefined, { leading: true, trailing: true }),
      exhaustMapWithTrailing(() => {
        return fromPromise(async () => {
          try {
            return await timed(
              'search$',
              table,
              () => ({ query: brief(query) }),
              async () => {
                const cache = await this.prefetchExists(table, query);
                const trx = await this.data.readonly(this.database);
                return this.data.search(trx, table, query, options, cache);
              }
            );
          } catch (error) {
            console.error('search error', error);
            throw error;
          }
        }).pipe(backoffRetry());
      })
    );
  }
  override aggregate$<
    T extends keyof IndexerSchema,
    const O extends AggregateOptions<T>,
  >(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O
  ): Observable<AggregateResult<T, O>> {
    return merge(of(1), this.watchTableUpdated(table)).pipe(
      throttleTime(3000, undefined, { leading: true, trailing: true }),
      exhaustMapWithTrailing(() => {
        return fromPromise(async () => {
          try {
            return await timed(
              'aggregate$',
              table,
              () => ({ query: brief(query), field }),
              async () => {
                const cache = await this.prefetchExists(table, query);
                const trx = await this.data.readonly(this.database);
                return this.data.aggregate(
                  trx,
                  table,
                  query,
                  field as string,
                  options,
                  cache
                );
              }
            );
          } catch (error) {
            console.error('aggregate error', error);
            throw error;
          }
        }).pipe(backoffRetry());
      })
    );
  }

  override async deleteByQuery<T extends keyof IndexerSchema>(
    table: T,
    query: Query<T>
  ): Promise<void> {
    this.pendingUpdates[table].deleteByQueries.push(query);
  }

  override insert<T extends keyof IndexerSchema>(
    table: T,
    document: IndexerDocument
  ): Promise<void> {
    this.pendingUpdates[table].inserts.push(document);
    return Promise.resolve();
  }

  override delete<T extends keyof IndexerSchema>(
    table: T,
    id: string
  ): Promise<void> {
    this.pendingUpdates[table].deletes.push(id);
    return Promise.resolve();
  }

  override update<T extends keyof IndexerSchema>(
    table: T,
    document: IndexerDocument
  ): Promise<void> {
    this.pendingUpdates[table].updates.push(document);
    return Promise.resolve();
  }

  override async refresh<T extends keyof IndexerSchema>(
    table: T
  ): Promise<void> {
    const tables = table ? [table] : (['doc', 'block'] as const);
    const sizes = Object.fromEntries(
      tables.map(t => {
        const p = this.pendingUpdates[t];
        return [
          t,
          {
            deleteByQueries: p.deleteByQueries.length,
            deletes: p.deletes.length,
            inserts: p.inserts.length,
            updates: p.updates.length,
          },
        ];
      })
    );
    await timed(
      'write',
      table ?? 'all',
      () => ({ wrote: sizes }),
      async () => {
        const trx = await this.data.readwrite(this.database);
        for (const table of tables) {
          await this.data.batchWrite(
            trx,
            table,
            this.pendingUpdates[table].deleteByQueries,
            this.pendingUpdates[table].deletes,
            this.pendingUpdates[table].inserts,
            this.pendingUpdates[table].updates
          );
          this.pendingUpdates[table] = {
            deleteByQueries: [],
            deletes: [],
            inserts: [],
            updates: [],
          };
        }
        // The data is on disk only once the transaction is done, and a
        // large one can take long to commit.
        await trx.done;
      }
    );
    this.data.invalidateExists();
    this.emitTableUpdated(table);
  }

  /** Channels already watched for another context's index writes. */
  private readonly watchedChannels = new WeakSet<BroadcastChannel>();

  /**
   * The query's `exists` clauses, resolved once and shared between queries
   * until the index is written (see DataStruct.prefetchExists).
   */
  private prefetchExists(table: keyof IndexerSchema, query: Query<any>) {
    // Another tab or worker writing the index says so on the channel.
    const channel = this.channel;
    if (!this.watchedChannels.has(channel)) {
      this.watchedChannels.add(channel);
      channel.addEventListener('message', (ev: MessageEvent) => {
        if (ev.data?.type === 'indexer-updated') this.data.invalidateExists();
      });
    }
    return this.data.prefetchExists(this.database, table, query);
  }

  override async refreshIfNeed(): Promise<void> {
    const needRefreshTable = Object.entries(this.pendingUpdates)
      .filter(
        ([, updates]) =>
          updates.deleteByQueries.length > 0 ||
          updates.deletes.length > 0 ||
          updates.inserts.length > 0 ||
          updates.updates.length > 0
      )
      .map(([table]) => table as keyof IndexerSchema);
    for (const table of needRefreshTable) {
      await this.refresh(table);
    }
  }

  private watchTableUpdated(table: keyof IndexerSchema) {
    return new Observable(subscriber => {
      const listener = (ev: MessageEvent) => {
        if (ev.data.type === 'indexer-updated' && ev.data.table === table) {
          // Before the query this starts, whichever listener runs first.
          this.data.invalidateExists();
          subscriber.next(1);
        }
      };

      const subscription = this.tableUpdate$.subscribe(updatedTable => {
        if (updatedTable === table) {
          subscriber.next(1);
        }
      });

      this.channel.addEventListener('message', listener);
      return () => {
        this.channel.removeEventListener('message', listener);
        subscription.unsubscribe();
      };
    });
  }

  emitTableUpdated(table: keyof IndexerSchema) {
    this.tableUpdate$.next(table);
    this.channel.postMessage({ type: 'indexer-updated', table });
  }

  // Get the current indexer version
  // increase this number to re-index all docs
  async indexVersion(): Promise<number> {
    // 2: block task-entity fields (tags, orgStatus, org timestamps, createdAt)
    return 2;
  }
}
