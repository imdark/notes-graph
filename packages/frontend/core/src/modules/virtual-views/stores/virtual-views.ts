import { Store } from '@notesgraph/infra';
import { nanoid } from 'nanoid';
import { map, type Observable } from 'rxjs';

import type { WorkspaceDBService } from '../../db';

export interface VirtualView {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  lastCrawledAt?: number | null;
  lastError?: string | null;
  createdAt: number;
}

export interface VirtualItem {
  id: string;
  viewId: string;
  externalId: string;
  title: string;
  url: string;
  snippet?: string | null;
  thumbnail?: string | null;
  publishedAt?: number | null;
}

export interface VirtualDataPoint {
  id: string;
  viewId: string;
  value: number;
  at: number;
}

interface VirtualViewRow {
  id: string;
  type: string;
  name: string;
  config: unknown;
  lastCrawledAt?: number | null;
  lastError?: string | null;
  createdAt: number;
}

/**
 * Local (Yjs-backed) storage for virtual views and their crawled items. Kept
 * local-first like projects/comments — crawled content isn't a real note.
 */
export class VirtualViewsStore extends Store {
  constructor(private readonly workspaceDBService: WorkspaceDBService) {
    super();
  }

  private get viewsTable() {
    return this.workspaceDBService.db.virtualViews;
  }

  private get itemsTable() {
    return this.workspaceDBService.db.virtualItems;
  }

  private get dataPointsTable() {
    return this.workspaceDBService.db.virtualDataPoints;
  }

  private toView(row: VirtualViewRow): VirtualView {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      config: (row.config ?? {}) as Record<string, unknown>,
      lastCrawledAt: row.lastCrawledAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
    };
  }

  watchViews(): Observable<VirtualView[]> {
    return this.viewsTable
      .find$()
      .pipe(
        map(rows =>
          (rows as VirtualViewRow[])
            .map(row => this.toView(row))
            .sort((a, b) => a.createdAt - b.createdAt)
        )
      );
  }

  watchItems(viewId: string): Observable<VirtualItem[]> {
    return this.itemsTable.find$({ viewId }).pipe(
      map(rows =>
        (rows as VirtualItem[])
          .slice()
          .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      )
    );
  }

  /** All crawled items across every view (for global quick-search). */
  watchAllItems(): Observable<VirtualItem[]> {
    return this.itemsTable
      .find$()
      .pipe(map(rows => rows as VirtualItem[]));
  }

  getView(id: string): VirtualView | null {
    const row = this.viewsTable.get(id) as VirtualViewRow | null;
    return row ? this.toView(row) : null;
  }

  // --- time series (trackers) -------------------------------------------

  watchDataPoints(viewId: string): Observable<VirtualDataPoint[]> {
    return this.dataPointsTable.find$({ viewId }).pipe(
      map(rows =>
        (rows as VirtualDataPoint[]).slice().sort((a, b) => a.at - b.at)
      )
    );
  }

  listDataPoints(viewId: string): VirtualDataPoint[] {
    return (this.dataPointsTable.find({ viewId }) as VirtualDataPoint[])
      .slice()
      .sort((a, b) => a.at - b.at);
  }

  appendDataPoint(viewId: string, value: number, at: number): VirtualDataPoint {
    return this.dataPointsTable.create({
      id: nanoid(),
      viewId,
      value,
      at,
    }) as VirtualDataPoint;
  }

  createView(input: {
    type: string;
    name: string;
    config: Record<string, unknown>;
  }): VirtualView {
    const row = this.viewsTable.create({
      id: nanoid(),
      type: input.type,
      name: input.name,
      config: input.config,
      createdAt: Date.now(),
    }) as VirtualViewRow;
    return this.toView(row);
  }

  updateView(id: string, patch: Partial<Omit<VirtualView, 'id'>>) {
    this.viewsTable.update(id, patch);
  }

  deleteView(id: string) {
    for (const item of this.itemsTable.find({ viewId: id }) as VirtualItem[]) {
      this.itemsTable.delete(item.id);
    }
    this.viewsTable.delete(id);
  }

  /** Replace a view's items with the freshly-crawled set (upsert + prune). */
  replaceItems(
    viewId: string,
    items: Array<Omit<VirtualItem, 'id' | 'viewId'>>
  ) {
    const nextIds = new Set(items.map(item => `${viewId}:${item.externalId}`));
    for (const existing of this.itemsTable.find({
      viewId,
    }) as VirtualItem[]) {
      if (!nextIds.has(existing.id)) {
        this.itemsTable.delete(existing.id);
      }
    }
    for (const item of items) {
      const id = `${viewId}:${item.externalId}`;
      const row = {
        id,
        viewId,
        externalId: item.externalId,
        title: item.title,
        url: item.url,
        snippet: item.snippet ?? null,
        thumbnail: item.thumbnail ?? null,
        publishedAt: item.publishedAt ?? null,
      };
      if (this.itemsTable.get(id)) {
        this.itemsTable.update(id, row);
      } else {
        this.itemsTable.create(row);
      }
    }
  }
}
