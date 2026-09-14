import type { DocRecord, DocStorage } from '../storage';

const MAX_CACHE_BYTES = 32 * 1024 * 1024;

/**
 * In-memory LRU cache of merged doc snapshots, sitting in front of a
 * DocStorage inside the worker.
 *
 * The first thing a page waits on before it can render anything useful is
 * `getDoc(rootDocId)`, which reads the snapshot + pending updates from
 * IndexedDB/SQLite and squashes them. Because the worker (and, with the
 * close grace period, the store) outlives page loads, serving that read from
 * memory turns the doc-list readiness gate on reloads and tab switches from
 * ~1s of storage latency into a lookup.
 *
 * Invalidation: every write path funnels through `pushDocUpdate` on the same
 * storage instance (frontend ops, the sync engine, and cross-context writes
 * via the storage's BroadcastChannel), all of which surface through
 * `subscribeDocUpdate`. Deletes don't emit, so `invalidate` must be called
 * explicitly where deletes are handled.
 */
export class DocRecordCache {
  private readonly cache = new Map<string, DocRecord>();
  private readonly inflight = new Map<string, Promise<DocRecord | null>>();
  private readonly versions = new Map<string, number>();
  private bytes = 0;
  private unsubscribe?: () => void;

  constructor(private readonly storage: DocStorage) {}

  getDoc(docId: string): Promise<DocRecord | null> {
    // subscribe lazily but always before reading, so no invalidation can be
    // missed for a record this cache holds
    this.unsubscribe ??= this.storage.subscribeDocUpdate(update => {
      this.invalidate(update.docId);
    });

    const hit = this.cache.get(docId);
    if (hit) {
      // refresh LRU position
      this.cache.delete(docId);
      this.cache.set(docId, hit);
      return Promise.resolve(hit);
    }

    let pending = this.inflight.get(docId);
    if (!pending) {
      const version = this.versions.get(docId) ?? 0;
      pending = this.storage
        .getDoc(docId)
        .then(record => {
          // an update may have landed while the read was in flight; only
          // cache if nothing invalidated this doc since the read started
          if (record && (this.versions.get(docId) ?? 0) === version) {
            this.put(record);
          }
          return record;
        })
        .finally(() => {
          this.inflight.delete(docId);
        });
      this.inflight.set(docId, pending);
    }
    return pending;
  }

  invalidate(docId: string) {
    this.versions.set(docId, (this.versions.get(docId) ?? 0) + 1);
    const cached = this.cache.get(docId);
    if (cached) {
      this.bytes -= cached.bin.byteLength;
      this.cache.delete(docId);
    }
  }

  private put(record: DocRecord) {
    if (record.bin.byteLength > MAX_CACHE_BYTES) {
      return;
    }
    while (this.bytes + record.bin.byteLength > MAX_CACHE_BYTES) {
      const oldest = this.cache.entries().next();
      if (oldest.done) {
        break;
      }
      this.bytes -= oldest.value[1].bin.byteLength;
      this.cache.delete(oldest.value[0]);
    }
    this.cache.set(record.docId, record);
    this.bytes += record.bin.byteLength;
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cache.clear();
    this.inflight.clear();
    this.versions.clear();
    this.bytes = 0;
  }
}
