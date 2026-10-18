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
  groupRowsByNote,
  LIST_PAGE_SIZE_OPTIONS,
  type ListRowNote,
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
  private rowBreadcrumb(rowId: string, underNote: boolean): string[] {
    const dataSource = this.logic.view.manager.dataSource as {
      rowBreadcrumb?: (
        id: string,
        options?: { underNote?: boolean }
      ) => string[];
    };
    return dataSource.rowBreadcrumb?.(rowId, { underNote }) ?? [];
  }

  /**
   * The source's note lookup, when it pulls rows from more than one note.
   * Duck-typed like rowBreadcrumb: a plain database has every row in itself,
   * so it has no notes to root its trees at.
   */
  private noteLookup(): ((rowId: string) => ListRowNote | null) | undefined {
    const dataSource = this.logic.view.manager.dataSource as {
      rowNote?: (id: string) => ListRowNote | null;
    };
    return dataSource.rowNote?.bind(dataSource);
  }

  private openNote(noteId: string) {
    const dataSource = this.logic.view.manager.dataSource as {
      openNote?: (id: string) => boolean;
    };
    dataSource.openNote?.(noteId);
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
    showToggle: boolean,
    root: { underNote: boolean } | null
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
    const crumbs = root ? this.rowBreadcrumb(row.rowId, root.underNote) : [];
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
          ${crumbs.length ? this.renderBreadcrumb(crumbs) : nothing}
        </span>
      </div>
      ${expanded
        ? repeat(
            children,
            child => child.rowId,
            child => this.renderRow(child, depth + 1, showToggle, null)
          )
        : nothing}`;
  }

  private renderBreadcrumb(crumbs: string[]) {
    return html`<span class="dv-list-breadcrumb" title=${crumbs.join(' › ')}
      >${crumbs.map(
        (crumb, i) =>
          html`${i > 0
              ? html`<span class="dv-list-crumb-sep">›</span>`
              : nothing}<span class="dv-list-crumb">${crumb}</span>`
      )}</span
    >`;
  }

  /**
   * A note's row, rooting the tree of its tasks below it. Folds like a task
   * with subtasks; its key is prefixed so it can't collide with a row id in
   * collapsed$.
   */
  private renderNote(note: ListRowNote, rows: Row[]): TemplateResult {
    const key = `note:${note.id}`;
    const expanded = !this.collapsed$.value.has(key);
    return html`<div
        class="dv-list-row dv-list-note"
        data-testid="dv-list-note"
        @click=${() => this.openNote(note.id)}
      >
        <button
          class="dv-list-toggle"
          type="button"
          aria-expanded=${expanded ? 'true' : 'false'}
          aria-label=${expanded ? 'Hide tasks' : 'Show tasks'}
          @click=${(e: Event) => this.toggleCollapsed(e, key)}
        ></button>
        <span class="dv-list-main">
          <span class="dv-list-text">${note.title || 'Untitled'}</span>
          ${note.breadcrumb.length
            ? this.renderBreadcrumb(note.breadcrumb)
            : nothing}
        </span>
      </div>
      ${expanded
        ? repeat(
            rows,
            row => row.rowId,
            row => this.renderRow(row, 1, true, { underNote: true })
          )
        : nothing}`;
  }

  private renderRows(rows: Row[]): unknown {
    const view = this.logic.view;
    const noteOf = this.noteLookup();
    if (!noteOf) {
      const showToggle = rows.some(row => view.childRows(row.rowId).length > 0);
      return repeat(
        rows,
        row => row.rowId,
        row => this.renderRow(row, 0, showToggle, { underNote: false })
      );
    }
    // Every note row folds, so the chevron column is always there.
    return repeat(
      groupRowsByNote(rows, noteOf),
      group => (group.note ? `note:${group.note.id}` : group.row.rowId),
      group =>
        group.note
          ? this.renderNote(group.note, group.rows)
          : this.renderRow(group.row, 0, true, { underNote: false })
    );
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
          : this.renderRows(visibleRows)}
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
