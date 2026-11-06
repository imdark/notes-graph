import type { Observable } from 'rxjs';
import { merge, of, Subject } from 'rxjs';
import { filter, throttleTime } from 'rxjs/operators';

import { share } from '../../../connection';
import type {
  AggregateOptions,
  AggregateResult,
  IndexerDocument,
  Query,
  SearchOptions,
  SearchResult,
} from '../../../storage';
import { IndexerStorageBase } from '../../../storage';
import { IndexerSchema } from '../../../storage/indexer/schema';
import { fromPromise } from '../../../utils/from-promise';
import { backoffRetry, exhaustMapWithTrailing } from '../../idb/indexer/utils';
import { NativeDBConnection, type SqliteNativeDBOptions } from '../db';
import { createNode, type ReadField } from './node-builder';
import { queryRaw } from './query';
import { getText, tryParseArrayField } from './utils';

const JS_INDEX_REVISION = 1;
const NODE_BATCH_SIZE = 50;
/** Ids per batched field read when aggregating over every hit. */
const AGGREGATE_BATCH_SIZE = 200;
/** Most stored fields kept read; past it the oldest go first. */
const FIELD_CACHE_SIZE = 50_000;

export class SqliteIndexerStorage extends IndexerStorageBase {
  static readonly identifier = 'SqliteIndexerStorage';
  override readonly recommendRefreshInterval = 30 * 1000; // 5 seconds
  readonly connection: NativeDBConnection;
  readonly isReadonly = false;
  private readonly tableUpdate$ = new Subject<string>();

  /**
   * Stored fields already read, by `table:field` and document id. Every field
   * of every hit is its own native round trip (on mobile: worker → page →
   * Capacitor), and the task queries rerun on every index write, so the
   * journal and its task boards re-read thousands of unchanged blocks each
   * time: ~14k calls that kept the phone's cores busy and its scrolling
   * stuck. A document's entries go when it is written or deleted here, the
   * only way the index changes.
   */
  private readonly fields = new Map<string, Map<string, string | null>>();
  private cachedFields = 0;
  /**
   * Ids written while a read was in flight, one set per read. A read that
   * overlapped a write to its own document is not kept; a write to another
   * document doesn't throw the read away. (A global "any write" guard made
   * every batched read during a cold start useless: the indexer was writing
   * the whole time.)
   */
  private readonly inFlightReads = new Set<Set<string>>();

  private readonly read: ReadField = async (table, field, id) => {
    const byId = this.fields.get(id);
    const key = `${table}:${field}`;
    if (byId?.has(key)) return byId.get(key);
    const dirty = new Set<string>();
    this.inFlightReads.add(dirty);
    let text: string | null;
    try {
      text = (await this.connection.apis.ftsGetDocument(key, id)) ?? null;
    } finally {
      this.inFlightReads.delete(dirty);
    }
    if (!dirty.has(id)) this.remember(id, key, text);
    return text;
  };

  /** Set once the native side has no batched read; per-id from then on. */
  private batchReadsUnsupported = false;

  /**
   * Read one stored field for many ids in a single native call and fill the
   * cache, so the per-node reads that follow are hits. A cold start answers
   * the notes tree's link query and the indexer's doc listing this way:
   * thousands of hits × fields, each its own round trip before.
   */
  private readonly readMany = async (
    table: string,
    field: string,
    ids: string[]
  ) => {
    if (this.batchReadsUnsupported) return;
    const key = `${table}:${field}`;
    const missing = ids.filter(id => !this.fields.get(id)?.has(key));
    if (missing.length === 0) return;
    const dirty = new Set<string>();
    this.inFlightReads.add(dirty);
    let texts: (string | null)[];
    try {
      const batch = this.connection.apis.ftsGetDocuments;
      if (!batch) throw new Error('no batched read');
      texts = await batch(key, missing);
    } catch {
      // Desktop's napi binding and older mobile builds have no batched read;
      // the per-id path still works, just one round trip at a time.
      this.batchReadsUnsupported = true;
      return;
    } finally {
      this.inFlightReads.delete(dirty);
    }
    missing.forEach((id, i) => {
      if (!dirty.has(id)) this.remember(id, key, texts[i] ?? null);
    });
  };

  private remember(id: string, key: string, text: string | null) {
    if (this.cachedFields >= FIELD_CACHE_SIZE) this.dropOldest();
    let entry = this.fields.get(id);
    if (!entry) {
      entry = new Map();
      this.fields.set(id, entry);
    }
    if (!entry.has(key)) this.cachedFields++;
    entry.set(key, text);
  }

  private forget(id: string) {
    for (const dirty of this.inFlightReads) dirty.add(id);
    const entry = this.fields.get(id);
    if (!entry) return;
    this.cachedFields -= entry.size;
    this.fields.delete(id);
  }

  private dropOldest() {
    // Maps keep insertion order: the first documents are the least recent.
    for (const [id, entry] of this.fields) {
      this.cachedFields -= entry.size;
      this.fields.delete(id);
      if (this.cachedFields < FIELD_CACHE_SIZE * 0.9) return;
    }
  }

  constructor(options: SqliteNativeDBOptions) {
    super();
    this.connection = share(new NativeDBConnection(options));
  }

  private watchTableUpdated(table: string) {
    return this.tableUpdate$.asObservable().pipe(filter(t => t === table));
  }

  async search<T extends keyof IndexerSchema, const O extends SearchOptions<T>>(
    table: T,
    query: Query<T>,
    options?: O
  ): Promise<SearchResult<T, O>> {
    const match = await queryRaw(this.connection, table, query);

    // Pagination
    const limit = options?.pagination?.limit ?? 10;
    const skip = options?.pagination?.skip ?? 0;
    const ids = match.toArray();
    const pagedIds = ids.slice(skip, skip + limit);

    // Built a batch at a time: every node is a few native round trips, and a
    // task query can page in hundreds of hits, which done one by one took long
    // enough on mobile for the journal's task lists to give up waiting.
    const nodes = [];
    for (let i = 0; i < pagedIds.length; i += NODE_BATCH_SIZE) {
      const batch = pagedIds.slice(i, i + NODE_BATCH_SIZE);
      if (options?.fields) {
        await Promise.all(
          options.fields.map(field =>
            this.readMany(table, field as string, batch)
          )
        );
      }
      nodes.push(
        ...(await Promise.all(
          batch.map(id =>
            createNode(
              this.connection,
              this.read,
              table,
              id,
              match.getScore(id),
              options ?? {},
              query
            )
          )
        ))
      );
    }

    return {
      pagination: {
        count: ids.length,
        limit,
        skip,
        hasMore: ids.length > skip + limit,
      },
      nodes,
    };
  }

  async aggregate<
    T extends keyof IndexerSchema,
    const O extends AggregateOptions<T>,
  >(
    table: T,
    query: Query<T>,
    field: keyof IndexerSchema[T],
    options?: O
  ): Promise<AggregateResult<T, O>> {
    const match = await queryRaw(this.connection, table, query);
    const ids = match.toArray();

    // The aggregated field of every hit, batched (see readMany). Chunked so
    // one native message stays a reasonable size for a few thousand hits.
    for (let i = 0; i < ids.length; i += AGGREGATE_BATCH_SIZE) {
      await this.readMany(
        table,
        field as string,
        ids.slice(i, i + AGGREGATE_BATCH_SIZE)
      );
    }

    const buckets: any[] = [];

    for (const id of ids) {
      const text = await this.read(table, field as string, id);
      if (text) {
        let values: string[] = [text];
        const parsed = tryParseArrayField(text);
        if (parsed) {
          values = parsed;
        }

        for (const val of values) {
          let bucket = buckets.find(b => b.key === val);
          if (!bucket) {
            bucket = { key: val, count: 0, score: 0 };
            if (options?.hits) {
              bucket.hits = {
                pagination: { count: 0, limit: 0, skip: 0, hasMore: false },
                nodes: [],
              };
            }
            buckets.push(bucket);
          }
          bucket.count++;

          if (options?.hits) {
            const hitLimit = options.hits.pagination?.limit ?? 3;
            if (bucket.hits.nodes.length < hitLimit) {
              const node = await createNode(
                this.connection,
                this.read,
                table,
                id,
                match.getScore(id),
                options.hits,
                query
              );
              bucket.hits.nodes.push(node);
              bucket.hits.pagination.count++;
            }
          }
        }
      }
    }

    return {
      pagination: {
        count: buckets.length,
        limit: 0,
        skip: 0,
        hasMore: false,
      },
      buckets,
    };
  }

  search$<T extends keyof IndexerSchema, const O extends SearchOptions<T>>(
    table: T,
    query: Query<T>,
    options?: O
  ): Observable<SearchResult<T, O>> {
    return merge(of(1), this.watchTableUpdated(table)).pipe(
      throttleTime(3000, undefined, { leading: true, trailing: true }),
      exhaustMapWithTrailing(() => {
        return fromPromise(async () => {
          return await this.search(table, query, options);
        }).pipe(backoffRetry());
      })
    );
  }

  aggregate$<
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
          return await this.aggregate(table, query, field, options);
        }).pipe(backoffRetry());
      })
    );
  }

  async deleteByQuery<T extends keyof IndexerSchema>(
    table: T,
    query: Query<T>
  ): Promise<void> {
    const match = await queryRaw(this.connection, table, query);
    const ids = match.toArray();
    for (const id of ids) {
      await this.delete(table, id);
    }
  }

  async insert<T extends keyof IndexerSchema>(
    table: T,
    document: IndexerDocument<T>
  ): Promise<void> {
    const schema = IndexerSchema[table];
    this.forget(document.id);
    for (const [field, values] of document.fields) {
      const fieldSchema = schema[field];
      // @ts-expect-error -- IndexerSchema uses runtime-keyed fields from each table schema.
      const shouldIndex = fieldSchema.index !== false;
      // @ts-expect-error -- IndexerSchema uses runtime-keyed fields from each table schema.
      const shouldStore = fieldSchema.store !== false;

      if (!shouldStore && !shouldIndex) continue;

      const text = getText(values);

      if (typeof text === 'string') {
        await this.connection.apis.ftsAddDocument(
          `${table}:${field as string}`,
          document.id,
          text,
          shouldIndex
        );
      }
    }
    // Again after: a read in between may have kept a half-written document.
    this.forget(document.id);
    this.tableUpdate$.next(table);
  }

  async delete<T extends keyof IndexerSchema>(
    table: T,
    id: string
  ): Promise<void> {
    const schema = IndexerSchema[table];
    this.forget(id);
    for (const field of Object.keys(schema)) {
      await this.connection.apis.ftsDeleteDocument(`${table}:${field}`, id);
    }
    this.forget(id);
    this.tableUpdate$.next(table);
  }

  async update<T extends keyof IndexerSchema>(
    table: T,
    document: IndexerDocument<T>
  ): Promise<void> {
    // Update is essentially insert (overwrite)
    return this.insert(table, document);
  }

  async refresh<T extends keyof IndexerSchema>(_table: T): Promise<void> {
    // No-op for memory index
  }

  async refreshIfNeed(): Promise<void> {
    await this.connection.apis.ftsFlushIndex();
  }

  async indexVersion(): Promise<number> {
    // The native version only moves with a native rebuild; this offset lets a
    // JS-side change to what gets indexed force a reindex too.
    // 1: blocks crawled by the JS crawler, so task fields are indexed
    return (
      (await this.connection.apis.ftsIndexVersion()) + JS_INDEX_REVISION * 1000
    );
  }
}
