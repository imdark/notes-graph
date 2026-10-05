import { PlusIcon } from '@blocksuite/icons/lit';
import type {
  ColumnBlockModel,
  ColumnsBlockModel,
} from '@blocksuite/notesgraph-model';
import { focusTextModel } from '@blocksuite/notesgraph-rich-text';
import {
  addColumn,
  removeColumn,
} from '@blocksuite/notesgraph-shared/utils';
import { BlockComponent } from '@blocksuite/std';
import { css, html, nothing } from 'lit';

/** Columns narrower than this wrap onto the next line instead of squeezing. */
export const COLUMN_MIN_WIDTH = 240;

/** A row never grows past this many columns from the "+" button. */
const MAX_COLUMNS = 6;

/** The narrowest share of a pair a drag-resize can leave one column. */
const MIN_RESIZE_SHARE = 0.15;

export class ColumnsBlockComponent extends BlockComponent<ColumnsBlockModel> {
  static override styles = css`
    notesgraph-columns {
      display: block;
      position: relative;
    }
    .notesgraph-columns-row {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
      gap: 12px 24px;
      padding: 4px 0;
    }
    .notesgraph-columns-add {
      position: absolute;
      top: 4px;
      right: -28px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--notesgraph-icon-color);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    notesgraph-columns:hover > .notesgraph-columns-add,
    .notesgraph-columns-add:focus-visible {
      opacity: 1;
    }
    .notesgraph-columns-add:hover {
      background: var(--notesgraph-hover-color);
    }
    .notesgraph-columns-add svg {
      width: 16px;
      height: 16px;
    }
  `;

  private readonly _addColumn = (event: MouseEvent) => {
    event.stopPropagation();
    this.store.captureSync();
    const paragraphId = addColumn(this.store, this.model);
    focusTextModel(this.std, paragraphId);
  };

  override renderBlock() {
    const canAdd =
      !this.store.readonly && this.model.children.length < MAX_COLUMNS;
    return html`
      <div class="notesgraph-columns-row" data-testid="columns-row">
        ${this.renderChildren(this.model)}
      </div>
      ${canAdd
        ? html`<button
            class="notesgraph-columns-add"
            contenteditable="false"
            data-testid="columns-add"
            title="Add column"
            aria-label="Add column"
            @click=${this._addColumn}
          >
            ${PlusIcon()}
          </button>`
        : nothing}
    `;
  }
}

export class ColumnBlockComponent extends BlockComponent<ColumnBlockModel> {
  static override styles = css`
    notesgraph-column {
      display: block;
      position: relative;
      min-width: 0;
      border-radius: 6px;
    }
    .notesgraph-column-empty {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 32px;
      padding: 4px 8px;
      border: 1px dashed var(--notesgraph-border-color);
      border-radius: 6px;
      color: var(--notesgraph-placeholder-color);
      font-size: var(--notesgraph-font-sm);
      cursor: text;
    }
    .notesgraph-column-empty button {
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
    }
    .notesgraph-column-resize {
      position: absolute;
      top: 0;
      bottom: 0;
      right: -14px;
      width: 4px;
      border-radius: 2px;
      cursor: col-resize;
      background: transparent;
      transition: background 0.15s;
    }
    notesgraph-column:last-child > .notesgraph-column-resize {
      display: none;
    }
    .notesgraph-column-resize:hover,
    .notesgraph-column-resize.dragging {
      background: var(--notesgraph-primary-color);
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.disposables.add(
      this.model.props.width$.subscribe(width => {
        this.style.flex = `${width > 0 ? width : 1} 1 ${COLUMN_MIN_WIDTH}px`;
      })
    );
  }

  private readonly _fillEmpty = (event: MouseEvent) => {
    if (this.store.readonly || this.model.children.length > 0) return;
    event.stopPropagation();
    const paragraphId = this.store.addBlock(
      'notesgraph:paragraph',
      {},
      this.model
    );
    focusTextModel(this.std, paragraphId);
  };

  private readonly _remove = (event: MouseEvent) => {
    event.stopPropagation();
    const focusId = removeColumn(this.store, this.model);
    if (focusId) focusTextModel(this.std, focusId);
  };

  /**
   * Drag the gap between this column and the next to trade width between
   * the two; the rest of the row keeps its share.
   */
  private readonly _startResize = (event: PointerEvent) => {
    const next = this.store.getNext(this.model) as ColumnBlockModel | null;
    const nextEl = next && this.std.view.getBlock(next.id);
    if (!next || !nextEl || this.store.readonly) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');

    const startX = event.clientX;
    const leftPx = this.getBoundingClientRect().width;
    const rightPx = nextEl.getBoundingClientRect().width;
    const totalPx = leftPx + rightPx;
    const totalWidth =
      (this.model.props.width || 1) + (next.props.width || 1);
    let leftShare = leftPx / totalPx;

    const onMove = (move: PointerEvent) => {
      leftShare = Math.min(
        1 - MIN_RESIZE_SHARE,
        Math.max(MIN_RESIZE_SHARE, (leftPx + move.clientX - startX) / totalPx)
      );
      this.style.flexGrow = String(leftShare * totalWidth);
      nextEl.style.flexGrow = String((1 - leftShare) * totalWidth);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.classList.remove('dragging');
      const round = (n: number) => Math.round(n * 100) / 100;
      this.store.captureSync();
      this.store.transact(() => {
        this.model.props.width = round(leftShare * totalWidth);
        next.props.width = round((1 - leftShare) * totalWidth);
      });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  override renderBlock() {
    const readonly = this.store.readonly;
    return html`
      ${this.model.children.length
        ? this.renderChildren(this.model)
        : html`<div
            class="notesgraph-column-empty"
            contenteditable="false"
            @click=${this._fillEmpty}
          >
            <span>Empty column</span>
            ${readonly
              ? nothing
              : html`<button
                  data-testid="column-remove"
                  @click=${this._remove}
                >
                  Remove
                </button>`}
          </div>`}
      ${!readonly
        ? html`<div
            class="notesgraph-column-resize"
            contenteditable="false"
            data-testid="column-resize"
            @pointerdown=${this._startResize}
          ></div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-columns': ColumnsBlockComponent;
    'notesgraph-column': ColumnBlockComponent;
  }
}
