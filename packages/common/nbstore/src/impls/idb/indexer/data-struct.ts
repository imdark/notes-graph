import { type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';

import {
  type AggregateOptions,
  type AggregateResult,
  type IndexerDocument,
  type IndexerFieldSchema,
  IndexerSchema,
  type Query,
  type SearchOptions,
  type SearchResult,
} from '../../../storage';
import { shallowEqual } from '../../../utils/shallow-equal';
import type { DocStorageSchema } from '../schema';
import { highlighter } from './highlighter';
import {
  BooleanInvertedIndex,
  flushFullTextStats,
  FullTextInvertedIndex,
  type FullTextStats,
  IntegerInvertedIndex,
  type InvertedIndex,
  StringInvertedIndex,
} from './inverted-index';
import { Match } from './match';

export type DataStructRWTransaction = IDBPTransaction<
  DocStorageSchema,
  ArrayLike<StoreNames<DocStorageSchema>>,
  'readwrite'
>;

export type DataStructROTransaction = IDBPTransaction<
  DocStorageSchema,
  ArrayLike<StoreNames<DocStorageSchema>>,
  'readonly' | 'readwrite'
>;

let debugMarkCount = 0;

export class DataStruct {
  database: IDBPDatabase<DocStorageSchema> = null as any;
  invertedIndex = new Map<string, Map<string, InvertedIndex>>();

  constructor() {
    for (const [tableName, table] of Object.entries(IndexerSchema)) {
      const tableInvertedIndex = new Map<string, InvertedIndex>();

      for (const [fieldName, type] of Object.entries(table)) {
        const typeInfo: IndexerFieldSchema =
          typeof type === 'string' ? { type } : type;
        if ('index' in typeInfo && typeInfo.index === false) {
          // If index is false, we don't need to create an inverted index for this field.
          continue;
        }
        if (typeInfo.type === 'String') {
          tableInvertedIndex.set(
            fieldName,
            new StringInvertedIndex(tableName, fieldName)
          );
        } else if (typeInfo.type === 'Integer') {
          tableInvertedIndex.set(
            fieldName,
            new IntegerInvertedIndex(tableName, fieldName)
          );
        } else if (typeInfo.type === 'FullText') {
          tableInvertedIndex.set(
            fieldName,
            new FullTextInvertedIndex(tableName, fieldName)
          );
        } else if (typeInfo.type === 'Boolean') {
          tableInvertedIndex.set(
            fieldName,
            new BooleanInvertedIndex(tableName, fieldName)
          );
        } else {
          throw new Error(`Field type '${typeInfo.type}' not supported`);
        }
      }

      this.invertedIndex.set(tableName, tableInvertedIndex);
    }
  }

  private async update(
    trx: DataStructRWTransaction,
    table: keyof IndexerSchema,
    document: IndexerDocument
  ) {
    using _ = await this.measure(`update`);
    const existsNid = await trx
      .objectStore('indexerRecords')
      .index('id')
      .getKey([table, document.id]);

    const exists = existsNid
      ? await trx.objectStore('indexerRecords').get(existsNid)
      : null;

    if (!existsNid || !exists) {
      // if not exists, return
      return false;
    }

    const dataMap = new Map([...exists.data, ...document.fields]); // merge exists data with new data
    if (sameFields(exists.data, dataMap)) {
      // nothing new: rewriting it would only cost the write
      return false;
    }

    // delete exists one
    const writes: Promise<unknown>[] = [];
    await this.deleteByNid(trx, existsNid, writes);
    await this.put(trx, table, document.id, dataMap, writes);
    await Promise.all(writes);
    return true;
  }

  /**
   * Store a record and its inverted-index rows. Only the record's own put
   * is waited for (its key goes in every index row); the index rows are
   * queued on the transaction and their promises collected in `writes`.
   * Waiting for each field in turn made a note of 461 blocks a 2.8 s write.
   */
  private async put(
    trx: DataStructRWTransaction,
    table: keyof IndexerSchema,
    id: string,
    dataMap: Map<any, string[]>,
    writes: Promise<unknown>[],
    stats?: FullTextStats
  ) {
    const nid = await trx
      .objectStore('indexerRecords')
      .put({ table, id, data: dataMap });

    for (const [key, values] of dataMap) {
      const type = IndexerSchema[table][
        key as keyof IndexerSchema[typeof table]
      ] as IndexerFieldSchema;
      if (!type) {
        continue;
      }

      const typeInfo = typeof type === 'string' ? { type } : type;
      if (typeInfo.index !== false) {
        // If index is false, the field will not be indexed
        const iidx = this.invertedIndex.get(table)?.get(key);
        if (!iidx) {
          continue;
        }
        writes.push(iidx.insert(trx, nid, values, stats));
      }
    }
  }

  private async insert(
    trx: DataStructRWTransaction,
    table: keyof IndexerSchema,
    document: IndexerDocument,
    writes: Promise<unknown>[],
    stats: FullTextStats
  ) {
    using _ = await this.measure(`insert`);
    const existsNid = await trx
      .objectStore('indexerRecords')
      .index('id')
      .getKey([table, document.id]);

    if (existsNid) {
      // delete exists one
      await this.deleteByNid(trx, existsNid, writes);
    }

    await this.put(trx, table, document.id, document.fields, writes, stats);
  }

  private async deleteByNid(
    trx: DataStructRWTransaction,
    nid: number,
    writes: Promise<unknown>[]
  ) {
    writes.push(trx.objectStore('indexerRecords').delete(nid));

    const indexIds = await trx
      .objectStore('invertedIndex')
      .index('nid')
      .getAllKeys(nid);

    for (const indexId of indexIds) {
      writes.push(trx.objectStore('invertedIndex').delete(indexId));
    }
  }

  private async delete(
    trx: DataStructRWTransaction,
    table: keyof IndexerSchema,
    id: string,
    writes: Promise<unknown>[]
  ) {
    using _ = await this.measure(`delete`);
    const nid = await trx
      .objectStore('indexerRecords')
      .index('id')
      .getKey([table, id]);

    if (nid) {
      await this.deleteByNid(trx, nid, writes);
      return true;
    }
    return false;
  }

  /**
   * Apply a batch. Returns whether it changed anything.
   *
   * A note is re-indexed as "delete every block of this note, insert them
   * all again", though an edit usually changes one block. A block whose
   * stored record already equals the one to insert is left as it is: not
   * deleted by the query, not inserted.
   */
  async batchWrite(
    trx: DataStructRWTransaction,
    table: keyof IndexerSchema,
    deleteByQueries: Query<any>[],
    deletes: string[],
    inserts: IndexerDocument<any>[],
    updates: IndexerDocument<any>[]
  ): Promise<boolean> {
    using _ = await this.measure(`batchWrite`);
    const writes: Promise<unknown>[] = [];
    const stats: FullTextStats = new Map();
    let changed = false;

    // What the queries would delete.
    const doomed = new Set<number>();
    for (const query of deleteByQueries) {
      const match = await this.queryRaw(trx, table, query);
      for (const nid of match.scores.keys()) doomed.add(nid);
    }

    // Inserting an id twice leaves the later one, so only that one counts.
    const lastInsert = new Map<string, IndexerDocument<any>>();
    for (const inst of inserts) {
      lastInsert.delete(inst.id);
      lastInsert.set(inst.id, inst);
    }

    const deleted = new Set(deletes);
    const records = trx.objectStore('indexerRecords');
    const toInsert: IndexerDocument<any>[] = [];
    for (const inst of lastInsert.values()) {
      // A record deleted by id in this batch is written afresh.
      if (!deleted.has(inst.id)) {
        const nid = await records.index('id').getKey([table, inst.id]);
        const stored = nid === undefined ? undefined : await records.get(nid);
        if (
          nid !== undefined &&
          stored &&
          sameFields(stored.data, inst.fields)
        ) {
          doomed.delete(nid);
          continue;
        }
      }
      toInsert.push(inst);
    }

    for (const nid of doomed) {
      await this.deleteByNid(trx, nid, writes);
      changed = true;
    }
    for (const del of deletes) {
      if (await this.delete(trx, table, del, writes)) changed = true;
    }
    for (const inst of toInsert) {
      await this.insert(trx, table, inst, writes, stats);
      changed = true;
    }
    await Promise.all(writes);
    await flushFullTextStats(trx, stats);
    for (const update of updates) {
      if (await this.update(trx, table, update)) changed = true;
    }
    return changed;
  }

  async matchAll(
    trx: DataStructROTransaction,
    table: keyof IndexerSchema
  ): Promise<Match> {
    const allNids = await trx
      .objectStore('indexerRecords')
      .index('table')
      .getAllKeys(table);
    const match = new Match();

    for (const nid of allNids) {
      match.addScore(nid, 1);
    }
    return match;
  }

  async queryRaw(
    trx: DataStructROTransaction,
    table: keyof IndexerSchema,
    query: Query<any>,
    cache: QueryCache = new QueryCache()
  ): Promise<Match> {
    const cached = cache.get(query);
    if (cached) {
      return cached;
    }

    const result = await (async () => {
      using _ = await this.measure(`query[${query.type}]`);
      if (query.type === 'match') {
        const iidx = this.invertedIndex.get(table)?.get(query.field as string);
        if (!iidx) {
          return new Match();
        }
        return await iidx.match(trx, query.match);
      } else if (query.type === 'boolean') {
        const weights = [];
        for (const q of query.queries) {
          weights.push(await this.queryRaw(trx, table, q, cache));
        }
        if (query.occur === 'must') {
          return weights.reduce((acc, w) => acc.and(w));
        } else if (query.occur === 'must_not') {
          const total = weights.reduce((acc, w) => acc.and(w));
          return (await this.matchAll(trx, table)).exclude(total);
        } else if (query.occur === 'should') {
          return weights.reduce((acc, w) => acc.or(w));
        }
      } else if (query.type === 'all') {
        return await this.matchAll(trx, table);
      } else if (query.type === 'boost') {
        return (await this.queryRaw(trx, table, query.query, cache)).boost(
          query.boost
        );
      } else if (query.type === 'exists') {
        const iidx = this.invertedIndex.get(table)?.get(query.field as string);
        if (!iidx) {
          return new Match();
        }
        return await iidx.all(trx);
      }
      throw new Error(`Query type '${query.type}' not supported`);
    })();

    cache.set(query, result);

    return result;
  }

  /**
   * `exists` matches every record that has a field, by reading the field's
   * whole range of the inverted index: about 100 ms in a workspace of 1,200
   * notes, whatever the rest of the query narrows it to. A note page keeps
   * some 60 live "links from these notes" queries, each with the same
   * `exists refDocId`, and every index write re-runs them all in every open
   * tab; IndexedDB serves them one after another, so one write held the
   * database for about a minute and a note opened meanwhile waited behind
   * it. The scan's result is the same for all of them, so it is done once and
   * shared until the index is next written.
   *
   * Keyed by table and field. The scans in flight are shared too, which is
   * why they run here, before the caller's transaction: awaiting another
   * transaction's request inside one lets it lapse.
   */
  private readonly existsScans = new Map<string, Promise<Match>>();

  /** The index was written: every shared `exists` result is out of date. */
  invalidateExists() {
    this.existsScans.clear();
  }

  /**
   * Resolve the query's `exists` clauses ahead of its transaction. Returns
   * the cache to hand to {@link search} or {@link aggregate}.
   *
   * A write that lands between this and the caller's transaction leaves the
   * `exists` part one write behind the rest. A live query is re-run by that
   * same write; a one-off query can be that much out of date.
   */
  async prefetchExists(
    database: IDBPDatabase<DocStorageSchema>,
    table: keyof IndexerSchema,
    query: Query<any>
  ): Promise<QueryCache> {
    const cache = new QueryCache();
    for (const exists of existsClauses(query)) {
      const iidx = this.invertedIndex.get(table)?.get(exists.field as string);
      if (!iidx) continue;
      const key = `${table}:${String(exists.field)}`;
      let scan = this.existsScans.get(key);
      if (!scan) {
        const started = (scan = this.readonly(database).then(trx =>
          iidx.all(trx)
        ));
        this.existsScans.set(key, started);
        started.catch(() => {
          if (this.existsScans.get(key) === started) {
            this.existsScans.delete(key);
          }
        });
      }
      try {
        cache.set(exists, await scan);
      } catch {
        // the query's own transaction scans it, and reports what failed
      }
    }
    return cache;
  }

  async clear(trx: DataStructRWTransaction) {
    await trx.objectStore('indexerRecords').clear();
    await trx.objectStore('invertedIndex').clear();
    await trx.objectStore('indexerMetadata').clear();
  }

  async search(
    trx: DataStructROTransaction,
    table: keyof IndexerSchema,
    query: Query<any>,
    options: SearchOptions<any> = {},
    cache?: QueryCache
  ): Promise<SearchResult<any, any>> {
    const pagination = {
      skip: options.pagination?.skip ?? 0,
      limit: options.pagination?.limit ?? 100,
    };

    const match = await this.queryRaw(trx, table, query, cache);

    const nids = match
      .toArray()
      .slice(pagination.skip, pagination.skip + pagination.limit);

    const nodes = [];
    for (const nid of nids) {
      const record = await trx.objectStore('indexerRecords').get(nid);
      if (!record) {
        continue;
      }
      nodes.push(this.resultNode(record, options, match, nid));
    }

    return {
      pagination: {
        count: match.size(),
        hasMore: match.size() > pagination.limit + pagination.skip,
        limit: pagination.limit,
        skip: pagination.skip,
      },
      nodes: nodes,
    };
  }

  async aggregate(
    trx: DataStructROTransaction,
    table: keyof IndexerSchema,
    query: Query<any>,
    field: string,
    options: AggregateOptions<any> = {},
    cache?: QueryCache
  ): Promise<AggregateResult<any, any>> {
    const pagination = {
      skip: options.pagination?.skip ?? 0,
      limit: options.pagination?.limit ?? 100,
    };

    const hitPagination = options.hits
      ? {
          skip: options.hits.pagination?.skip ?? 0,
          limit: options.hits.pagination?.limit ?? 3,
        }
      : { skip: 0, limit: 0 };

    const match = await this.queryRaw(trx, table, query, cache);

    const nids = match.toArray();

    const buckets: {
      key: string;
      nids: number[];
      hits: SearchResult<any, any>['nodes'];
    }[] = [];

    for (const nid of nids) {
      const record = await trx.objectStore('indexerRecords').get(nid);
      if (!record) {
        continue;
      }
      const values = record.data.get(field);
      for (const value of values ?? []) {
        let bucket;
        let bucketIndex = buckets.findIndex(b => b.key === value);
        if (bucketIndex === -1) {
          bucket = { key: value, nids: [], hits: [] };
          buckets.push(bucket);
          bucketIndex = buckets.length - 1;
        } else {
          bucket = buckets[bucketIndex];
        }

        if (
          bucketIndex >= pagination.skip &&
          bucketIndex < pagination.skip + pagination.limit
        ) {
          bucket.nids.push(nid);
          if (
            bucket.nids.length - 1 >= hitPagination.skip &&
            bucket.nids.length - 1 < hitPagination.skip + hitPagination.limit
          ) {
            bucket.hits.push(
              this.resultNode(record, options.hits ?? {}, match, nid)
            );
          }
        }
      }
    }

    return {
      buckets: buckets
        .slice(pagination.skip, pagination.skip + pagination.limit)
        .map(bucket => {
          const result = {
            key: bucket.key,
            score: match.getScore(bucket.nids[0]),
            count: bucket.nids.length,
          } as AggregateResult<any, any>['buckets'][number];

          if (options.hits) {
            (result as any).hits = {
              pagination: {
                count: bucket.nids.length,
                hasMore:
                  bucket.nids.length > hitPagination.limit + hitPagination.skip,
                limit: hitPagination.limit,
                skip: hitPagination.skip,
              },
              nodes: bucket.hits,
            } as SearchResult<any, any>;
          }

          return result;
        }),
      pagination: {
        count: buckets.length,
        hasMore: buckets.length > pagination.limit + pagination.skip,
        limit: pagination.limit,
        skip: pagination.skip,
      },
    };
  }

  async readonly(database: IDBPDatabase<DocStorageSchema>) {
    return database.transaction(
      ['indexerRecords', 'invertedIndex', 'indexerMetadata'],
      'readonly',
      { durability: 'relaxed' }
    );
  }

  async readwrite(database: IDBPDatabase<DocStorageSchema>) {
    return database.transaction(
      ['indexerRecords', 'invertedIndex', 'indexerMetadata'],
      'readwrite',
      { durability: 'relaxed' }
    );
  }

  private resultNode(
    record: { id: string; data: Map<string, string[]> },
    options: SearchOptions<any>,
    match?: Match,
    nid?: number
  ): SearchResult<any, any>['nodes'][number] {
    const node = {
      id: record.id,
      score: match && nid ? match.getScore(nid) : 1,
    } as any;

    if (options.fields) {
      const fields = {} as Record<string, string | string[]>;
      for (const field of options.fields as string[]) {
        fields[field] = record.data.get(field) ?? [''];
        if (fields[field].length === 1) {
          fields[field] = fields[field][0];
        }
      }
      node.fields = fields;
    }

    if (match && nid && options.highlights) {
      const highlights = {} as Record<string, string[]>;
      for (const { field, before, end } of options.highlights) {
        const highlightValues = match.getHighlighters(nid, field);
        if (highlightValues) {
          const rawValues = record.data.get(field) ?? [];
          highlights[field] = Array.from(highlightValues)
            .map(([index, ranges]) => {
              const raw = rawValues[index];

              if (raw) {
                return (
                  highlighter(raw, before, end, ranges, {
                    maxPrefix: 20,
                    maxLength: 50,
                  }) ?? ''
                );
              }

              return '';
            })
            .filter(Boolean);
        }
      }
      node.highlights = highlights;
    }

    return node;
  }

  async measure(name: string) {
    const count = debugMarkCount++;
    performance.mark(`${name}Start(${count})`);
    return {
      [Symbol.dispose]: () => {
        performance.mark(`${name}End(${count})`);
        performance.measure(
          `${name}`,
          `${name}Start(${count})`,
          `${name}End(${count})`
        );
      },
    };
  }
}
/** Whether two records hold the same fields with the same values. */
function sameFields(a: Map<any, string[]>, b: Map<any, string[]>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, values] of a) {
    const other = b.get(key);
    if (!other || other.length !== values.length) return false;
    for (let i = 0; i < values.length; i++) {
      if (other[i] !== values[i]) return false;
    }
  }
  return true;
}

/** Every `exists` clause in a query, however deeply nested. */
function existsClauses(
  query: Query<any>
): Extract<Query<any>, { type: 'exists' }>[] {
  if (query.type === 'exists') return [query];
  if (query.type === 'boolean') return query.queries.flatMap(existsClauses);
  if (query.type === 'boost') return existsClauses(query.query);
  return [];
}

export class QueryCache {
  private readonly cache: [Query<any>, Match][] = [];

  get(query: Query<any>) {
    return this.cache.find(q => shallowEqual(q[0], query))?.[1];
  }

  set(query: Query<any>, match: Match) {
    this.cache.push([query, match]);
  }
}
