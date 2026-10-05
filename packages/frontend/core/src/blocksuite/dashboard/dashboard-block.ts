import { focusTextModel } from '@blocksuite/notesgraph/rich-text';
import { BlockComponent } from '@blocksuite/notesgraph/std';
import { css, html, type PropertyValues } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

import {
  type DashboardBlockModel,
  MAX_DASHBOARD_COLUMNS,
  type WidgetBlockModel,
  type WidgetBlockProps,
  WidgetBlockFlavour,
} from './model';

export const DASHBOARD_BLOCK_TAG = 'notesgraph-dashboard-block';

/** Keep the editor's key and pointer handling out of the header's inputs. */
export const stopEditorEvents = (e: Event) => e.stopPropagation();

/**
 * A dashboard: its children are tiles laid side by side, `columns` to a row,
 * flowing right and wrapping. Text tiles are ordinary blocks, so they edit
 * like the rest of the note; a chart widget can span several columns.
 */
export class DashboardBlockComponent extends BlockComponent<DashboardBlockModel> {
  static override styles = css`
    notesgraph-dashboard-block {
      display: block;
      margin: 8px 0;
    }
    .ng-dashboard {
      border: 1px solid var(--notesgraph-border-color);
      border-radius: 8px;
      padding: 8px 12px 12px;
    }
    .ng-dashboard-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      user-select: none;
    }
    .ng-dashboard-title {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      font-size: 15px;
      font-weight: 600;
      color: var(--notesgraph-text-primary-color);
      padding: 2px 0;
    }
    .ng-dashboard-title::placeholder {
      color: var(--notesgraph-placeholder-color);
    }
    .ng-dashboard-tools {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--notesgraph-text-secondary-color);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .ng-dashboard:hover .ng-dashboard-tools,
    .ng-dashboard:focus-within .ng-dashboard-tools {
      opacity: 1;
    }
    /* no hover on a phone: keep them showing */
    @media (hover: none) {
      .ng-dashboard-tools {
        opacity: 1;
        flex-wrap: wrap;
      }
    }
    .ng-dashboard-tools button {
      border: 1px solid var(--notesgraph-border-color);
      background: var(--notesgraph-background-primary-color);
      color: var(--notesgraph-text-secondary-color);
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 12px;
      line-height: 18px;
      cursor: pointer;
    }
    .ng-dashboard-tools button:hover,
    .ng-dashboard-tools button[data-active='true'] {
      color: var(--notesgraph-primary-color);
      border-color: var(--notesgraph-primary-color);
    }
    .ng-dashboard-grid {
      display: grid;
      gap: 12px;
      align-items: stretch;
    }
    /* every child block is a tile */
    .ng-dashboard-grid > * {
      min-width: 0;
      margin: 0 !important;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--notesgraph-background-secondary-color);
      box-sizing: border-box;
    }
    .ng-dashboard-empty {
      grid-column: 1 / -1;
      font-size: 13px;
      color: var(--notesgraph-text-secondary-color);
    }
    @media (max-width: 640px) {
      .ng-dashboard-grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      .ng-dashboard-grid > * {
        grid-column: auto !important;
      }
    }
  `;

  private get columns(): number {
    const columns = Math.round(this.model.props.columns$.value || 1);
    return Math.min(Math.max(columns, 1), MAX_DASHBOARD_COLUMNS);
  }

  /** Columns each chart tile spans, from the last render. */
  private _spans = new Map<string, number>();

  /**
   * How many columns each chart tile spans, never wider than the row. Read
   * through the props' signals, so a tile's width change re-renders this.
   */
  private tileSpans(columns: number): Map<string, number> {
    const spans = new Map<string, number>();
    for (const child of this.model.children) {
      if (child.flavour !== WidgetBlockFlavour) continue;
      const span = Math.round(
        (child as WidgetBlockModel).props.span$.value || 1
      );
      spans.set(child.id, Math.min(Math.max(span, 1), columns));
    }
    return spans;
  }

  override updated(changed: PropertyValues) {
    super.updated(changed);
    // The tiles are the children's own elements, so place them directly.
    // Dashboards don't nest, so the first grid inside is this one's.
    const grid = this.querySelector('.ng-dashboard-grid');
    if (!grid) return;
    for (const tile of Array.from(grid.children) as HTMLElement[]) {
      const span = this._spans.get(tile.dataset.blockId ?? '') ?? 1;
      tile.style.gridColumn = span > 1 ? `span ${span}` : '';
    }
  }

  private readonly _setColumns = (columns: number) => {
    if (this.store.readonly) return;
    this.store.updateBlock(this.model, { columns });
  };

  private readonly _setTitle = (e: Event) => {
    const title = (e.target as HTMLInputElement).value;
    if (title !== this.model.props.title) {
      this.store.updateBlock(this.model, { title });
    }
  };

  private readonly _addText = () => {
    const id = this.store.addBlock('notesgraph:paragraph', {}, this.model);
    focusTextModel(this.std, id);
  };

  private readonly _addWidget = (props: Partial<WidgetBlockProps>) => {
    this.store.addBlock(WidgetBlockFlavour, props, this.model);
  };

  private renderTools() {
    if (this.store.readonly) return null;
    const columns = this.columns;
    return html`<div
      class="ng-dashboard-tools"
      @pointerdown=${stopEditorEvents}
      @mousedown=${stopEditorEvents}
    >
      <span>Columns</span>
      ${Array.from({ length: MAX_DASHBOARD_COLUMNS }, (_, i) => i + 1).map(
        n =>
          html`<button
            data-active=${n === columns}
            title=${`${n} tile${n === 1 ? '' : 's'} per row`}
            @click=${() => this._setColumns(n)}
          >
            ${n}
          </button>`
      )}
      <span style="width: 8px"></span>
      <button title="Add a text tile" @click=${this._addText}>+ Text</button>
      <button
        title="Add a chart of a monitor's values"
        @click=${() => this._addWidget({ kind: 'line' })}
      >
        + Chart
      </button>
      <button
        title="Add a tile with a monitor's latest value"
        @click=${() => this._addWidget({ kind: 'stat' })}
      >
        + Stat
      </button>
      <button
        title="Add a bar chart of this note's tasks by status"
        @click=${() => this._addWidget({ kind: 'tasks' })}
      >
        + Tasks
      </button>
    </div>`;
  }

  override renderBlock() {
    const columns = this.columns;
    const empty = this.model.children.length === 0;
    this._spans = this.tileSpans(columns);
    return html`<div class="ng-dashboard" data-testid="dashboard-block">
      <div class="ng-dashboard-header" contenteditable="false">
        <input
          class="ng-dashboard-title"
          placeholder="Dashboard"
          .value=${this.model.props.title$.value ?? ''}
          ?disabled=${this.store.readonly}
          @change=${this._setTitle}
          @keydown=${stopEditorEvents}
          @beforeinput=${stopEditorEvents}
          @input=${stopEditorEvents}
          @paste=${stopEditorEvents}
          @pointerdown=${stopEditorEvents}
          @mousedown=${stopEditorEvents}
        />
        ${this.renderTools()}
      </div>
      <div
        class="ng-dashboard-grid"
        data-columns=${columns}
        style=${styleMap({
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          '--ng-dashboard-columns': String(columns),
        })}
      >
        ${empty
          ? html`<div class="ng-dashboard-empty" contenteditable="false">
              Empty dashboard. Add a tile with the buttons above.
            </div>`
          : this.renderChildren(this.model)}
      </div>
    </div>`;
  }
}

if (!customElements.get(DASHBOARD_BLOCK_TAG)) {
  customElements.define(DASHBOARD_BLOCK_TAG, DashboardBlockComponent);
}
