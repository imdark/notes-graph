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
import type { Row } from '../../../core/view-manager/row.js';
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
  // Rows whose subtasks are folded away. Everything starts expanded, so open
  // subtasks are never hidden until someone asks.
  private readonly collapsed$ = signal<ReadonlySet<string>>(new Set());

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

  /**
   * Tick or untick a row from the list.
   *
   * `stopPropagation` because the whole row opens the task on click - without
   * it, ticking would also navigate away from the list you are working
   * through, which is the opposite of what a checkbox is for.
   *
   * Nothing is removed here. When the view filters to incomplete tasks the
   * row leaves on its own, because the source re-runs its criteria on the
   * text edit this write makes.
   */
  private toggleDone(event: Event, rowId: string): void {
    event.stopPropagation();
    const dataSource = this.logic.view.manager.dataSource;
    if (!dataSource.taskDoneSet) return;
    dataSource.taskDoneSet(rowId, !dataSource.taskDoneGet?.(rowId));
  }

  private toggleCollapsed(event: Event, rowId: string): void {
    event.stopPropagation();
    const next = new Set(this.collapsed$.value);
    if (!next.delete(rowId)) next.add(rowId);
    this.collapsed$.value = next;
  }

  /**
   * One row and, unless it is collapsed, its subtasks beneath it.
   *
   * `showToggle` reserves the chevron column even on leaf rows whenever the
   * list has any tree in it, so checkboxes at the same depth line up.
   */
  private renderRow(
    row: Row,
    depth: number,
    showToggle: boolean
  ): TemplateResult {
    const view = this.logic.view;
    const dataSource = view.manager.dataSource;
    const canToggle = !!dataSource.taskDoneSet;
    const titleColumn = view.mainProperties$.value.titleColumn;
    const title = titleColumn
      ? view.cellGetOrCreate(row.rowId, titleColumn).stringValue$.value
      : '';
    // A subtask sits right under its parent, so the trail would only repeat
    // what is one line up.
    const crumbs = depth === 0 ? this.rowBreadcrumb(row.rowId) : [];
    const done = dataSource.taskDoneGet?.(row.rowId) ?? false;
    const children = view.childRows(row.rowId);
    const expanded = !this.collapsed$.value.has(row.rowId);

    return html`<div
        class="dv-list-row"
        style=${depth ? `--dv-list-depth: ${depth}` : nothing}
        @click=${() => this.openRow(row.rowId)}
      >
        ${showToggle
          ? children.length
            ? html`<button
                class="dv-list-toggle"
                type="button"
                aria-expanded=${expanded ? 'true' : 'false'}
                aria-label=${expanded ? 'Hide subtasks' : 'Show subtasks'}
                @click=${(e: Event) => this.toggleCollapsed(e, row.rowId)}
              ></button>`
            : html`<span class="dv-list-toggle"></span>`
          : nothing}
        ${canToggle
          ? html`<button
              class="dv-list-checkbox"
              type="button"
              role="checkbox"
              aria-checked=${done ? 'true' : 'false'}
              aria-label=${done ? 'Mark task as not done' : 'Mark task as done'}
              ?data-checked=${done}
              @click=${(e: Event) => this.toggleDone(e, row.rowId)}
            ></button>`
          : html`<span class="dv-list-checkbox"></span>`}
        <span class="dv-list-main">
          <span class="dv-list-text" ?data-done=${done}
            >${title || 'Untitled'}</span
          >
          ${crumbs.length
            ? html`<span class="dv-list-breadcrumb" title=${crumbs.join(' › ')}
                >${crumbs.map(
                  (crumb, i) =>
                    html`${i > 0
                        ? html`<span class="dv-list-crumb-sep">›</span>`
                        : nothing}<span class="dv-list-crumb">${crumb}</span>`
                )}</span
              >`
            : nothing}
        </span>
      </div>
      ${expanded
        ? repeat(
            children,
            child => child.rowId,
            child => this.renderRow(child, depth + 1, showToggle)
          )
        : nothing}`;
  }

  override render(): TemplateResult {
    const view = this.logic.view;
    const rows = view.rows$.value;

    const total = rows.length;
    const pageSize = view.pageSize$.value;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    // Clamp here so a shrinking result set (filter/search) never strands us on
    // an out-of-range page.
    const page = Math.min(Math.max(this.page$.value, 0), pageCount - 1);
    const visibleRows = rows.slice(page * pageSize, page * pageSize + pageSize);
    const needsPager = total > pageSize;
    const showToggle = visibleRows.some(
      row => view.childRows(row.rowId).length > 0
    );

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
              row => this.renderRow(row, 0, showToggle)
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
