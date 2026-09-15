import { signal } from '@preact/signals-core';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../../core/index.js';
import {
  DataViewUIBase,
  DataViewUILogicBase,
} from '../../../core/view/data-view-base.js';
import {
  LIST_PAGE_SIZE_OPTIONS,
  type ListSingleView,
} from '../list-view-manager.js';
import { listViewStyles } from './styles.js';

export class ListViewUILogic extends DataViewUILogicBase<ListSingleView> {
  clearSelection = () => {
    this.setSelection(undefined);
  };

  // A query list is read-only — rows live in their source docs.
  addRow = () => undefined;

  focusFirstCell = () => {};

  showIndicator = () => false;

  hideIndicator = () => {};

  moveTo = () => {};

  renderer = createUniComponentFromWebComponent(ListViewUI);
}

export class ListViewUI extends DataViewUIBase<ListViewUILogic> {
  static override styles = listViewStyles;

  // Current page (0-based). Local UI state — not persisted; the page size is.
  private readonly page$ = signal(0);

  override connectedCallback(): void {
    super.connectedCallback();
    this.dataset['testid'] = 'dv-list-view';
  }

  private goToPage(page: number) {
    this.page$.value = page;
  }

  private changePageSize(size: number) {
    this.logic.view.pageSizeSet(size);
    this.page$.value = 0;
  }

  private renderPager(total: number, pageSize: number, page: number) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const sizeOptions = LIST_PAGE_SIZE_OPTIONS.includes(pageSize)
      ? LIST_PAGE_SIZE_OPTIONS
      : [...LIST_PAGE_SIZE_OPTIONS, pageSize].sort((a, b) => a - b);
    return html`<div class="dv-list-pager">
      <select
        class="dv-list-page-size"
        data-testid="dv-list-page-size"
        title="Rows per page"
        @change=${(e: Event) =>
          this.changePageSize(Number((e.target as HTMLSelectElement).value))}
      >
        ${sizeOptions.map(
          size =>
            html`<option value=${size} ?selected=${size === pageSize}>
              ${size} / page
            </option>`
        )}
      </select>
      <div class="dv-list-pager-nav">
        <button
          class="dv-list-page-btn"
          data-testid="dv-list-prev"
          ?disabled=${page <= 0}
          @click=${() => this.goToPage(page - 1)}
        >
          ‹
        </button>
        <span class="dv-list-page-info">${page + 1} / ${pageCount}</span>
        <button
          class="dv-list-page-btn"
          data-testid="dv-list-next"
          ?disabled=${page >= pageCount - 1}
          @click=${() => this.goToPage(page + 1)}
        >
          ›
        </button>
      </div>
    </div>`;
  }

  /**
   * Breadcrumb segments for a row, when the data source can supply them.
   *
   * Duck-typed like openRowSource: a plain database has no cross-doc context
   * to offer, so it simply doesn't implement this and rows render bare.
   */
  private rowBreadcrumb(rowId: string): string[] {
    const dataSource = this.logic.view.manager.dataSource as {
      rowBreadcrumb?: (id: string) => string[];
    };
    return dataSource.rowBreadcrumb?.(rowId) ?? [];
  }

  private openRow(rowId: string) {
    // Query rows are real blocks in other docs — prefer navigating to the
    // source block over the in-database row detail (which is empty for a
    // cross-doc query row). Data sources that can't (a plain database) fall
    // back to the detail panel.
    const dataSource = this.logic.view.manager.dataSource as {
      openRowSource?: (id: string) => boolean;
    };
    if (dataSource.openRowSource?.(rowId)) {
      return;
    }
    this.logic.root.openDetailPanel({
      view: this.logic.view,
      rowId,
    });
  }

  override render(): TemplateResult {
    const view = this.logic.view;
    const titleColumn = view.mainProperties$.value.titleColumn;
    const rows = view.rows$.value;

    const total = rows.length;
    const pageSize = view.pageSize$.value;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    // Clamp here so a shrinking result set (filter/search) never strands us on
    // an out-of-range page.
    const page = Math.min(Math.max(this.page$.value, 0), pageCount - 1);
    const visibleRows = rows.slice(page * pageSize, page * pageSize + pageSize);
    const needsPager = total > pageSize;

    return html`
      ${this.logic.headerWidget
        ? renderUniLit(this.logic.headerWidget, {
            dataViewLogic: this.logic,
          })
        : ''}
      <div class="dv-list">
        ${total === 0
          ? // "No results." only once the source has finished looking —
            // a query board resolves its rows across docs asynchronously, so
            // showing the empty state first reads as "you have no tasks".
            view.rowsLoading$.value
            ? html`<div class="dv-list-loading">
                <span class="dv-list-spinner"></span>
                <span>Loading tasks…</span>
              </div>`
            : html`<div class="dv-list-empty">No results.</div>`
          : repeat(
              visibleRows,
              row => row.rowId,
              row => {
                const title = titleColumn
                  ? view.cellGetOrCreate(row.rowId, titleColumn).stringValue$
                      .value
                  : '';
                const crumbs = this.rowBreadcrumb(row.rowId);
                return html`<div
                  class="dv-list-row"
                  @click=${() => this.openRow(row.rowId)}
                >
                  <span class="dv-list-checkbox"></span>
                  <span class="dv-list-main">
                    <span class="dv-list-text">${title || 'Untitled'}</span>
                    ${crumbs.length
                      ? html`<span
                          class="dv-list-breadcrumb"
                          title=${crumbs.join(' › ')}
                          >${crumbs.map(
                            (crumb, i) =>
                              html`${i > 0
                                ? html`<span class="dv-list-crumb-sep">›</span>`
                                : nothing}<span class="dv-list-crumb"
                                  >${crumb}</span
                                >`
                          )}</span
                        >`
                      : nothing}
                  </span>
                </div>`;
              }
            )}
        ${total > 0 && view.rowsLoading$.value
          ? html`<div class="dv-list-loading dv-list-loading-more">
              <span class="dv-list-spinner"></span>
              <span>Loading more…</span>
            </div>`
          : nothing}
      </div>
      ${needsPager ? this.renderPager(total, pageSize, page) : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-data-view-list': ListViewUI;
  }
}
