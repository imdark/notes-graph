import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import { CenterPeekIcon, MoreHorizontalIcon } from '@blocksuite/icons/lit';
import { popupTargetFromElement } from '@blocksuite/notesgraph-components/context-menu';
import { ShadowlessElement } from '@blocksuite/std';
import { signal } from '@preact/signals-core';
import { cssVarV2 } from '@toeverything/theme/v2';
import { css, unsafeCSS } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { html } from 'lit/static-html.js';

import type { KanbanColumn } from '../kanban-view-manager.js';
import type { KanbanViewUILogic } from './kanban-view-ui-logic.js';
import { openDetail, popCardMenu } from './menu.js';

const styles = css`
  notesgraph-data-view-kanban-card {
    display: flex;
    position: relative;
    flex-direction: column;
    border: 1px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
    box-shadow: 0px 2px 3px 0px rgba(0, 0, 0, 0.05);
    border-radius: 8px;
    transition: background-color 100ms ease-in-out;
    background-color: var(--notesgraph-background-kanban-card-color);
  }

  notesgraph-data-view-kanban-card:hover {
    background-color: var(--notesgraph-hover-color);
  }

  notesgraph-data-view-kanban-card .card-header {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  notesgraph-data-view-kanban-card .card-header-title uni-lit {
    width: 100%;
  }

  .card-header.has-divider {
    border-bottom: 0.5px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
  }

  notesgraph-data-view-kanban-card .card-header-title {
    font-size: var(--data-view-cell-text-size);
    line-height: var(--data-view-cell-text-line-height);
  }

  notesgraph-data-view-kanban-card .card-header-icon {
    padding: 4px;
    background-color: var(--notesgraph-background-secondary-color);
    display: flex;
    align-items: center;
    border-radius: 4px;
    width: max-content;
  }

  notesgraph-data-view-kanban-card .card-type-badge {
    display: inline-flex;
    align-items: center;
    width: max-content;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 18px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  notesgraph-data-view-kanban-card .card-badges {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  notesgraph-data-view-kanban-card .card-progress-chip {
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 18px;
    font-weight: 600;
    color: var(--notesgraph-text-secondary-color);
    background-color: var(--notesgraph-hover-color);
  }

  notesgraph-data-view-kanban-card .card-children {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px 8px;
    border-top: 0.5px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
  }

  notesgraph-data-view-kanban-card .card-child {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 4px;
    border: 0.5px solid ${unsafeCSS(cssVarV2.layer.insideBorder.border)};
    background-color: var(--notesgraph-background-secondary-color);
    cursor: pointer;
    font-size: 12px;
    line-height: 18px;
  }

  notesgraph-data-view-kanban-card .card-child:hover {
    background-color: var(--notesgraph-hover-color);
  }

  notesgraph-data-view-kanban-card .card-child-check {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border-radius: 3px;
    border: 1px solid var(--notesgraph-icon-color);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    line-height: 1;
  }

  notesgraph-data-view-kanban-card .card-child.done .card-child-check {
    background-color: var(--notesgraph-brand-color, #1e96eb);
    border-color: var(--notesgraph-brand-color, #1e96eb);
    color: #fff;
  }

  notesgraph-data-view-kanban-card .card-child-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  notesgraph-data-view-kanban-card .card-child.done .card-child-text {
    text-decoration: line-through;
    opacity: 0.6;
  }

  notesgraph-data-view-kanban-card .card-header-icon svg {
    width: 16px;
    height: 16px;
    fill: var(--notesgraph-icon-color);
    color: var(--notesgraph-icon-color);
  }

  notesgraph-data-view-kanban-card .card-body {
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 4px;
  }

  notesgraph-data-view-kanban-card:hover .card-ops {
    visibility: visible;
  }
  notesgraph-data-view-kanban-card:has(.active) .card-ops {
    visibility: visible;
  }

  notesgraph-data-view-kanban-card:has([data-editing='true']) .card-ops {
    visibility: hidden;
  }

  .card-ops {
    position: absolute;
    right: 8px;
    top: 8px;
    visibility: hidden;
    display: flex;
    gap: 4px;
    cursor: pointer;
  }

  .card-op {
    display: flex;
    position: relative;
    padding: 4px;
    border-radius: 4px;
    box-shadow: 0px 0px 4px 0px rgba(66, 65, 73, 0.14);
    background-color: var(--notesgraph-background-primary-color);
  }

  .card-op:hover:before {
    content: '';
    border-radius: 4px;
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    background-color: var(--notesgraph-hover-color);
  }

  .card-op svg {
    fill: var(--notesgraph-icon-color);
    color: var(--notesgraph-icon-color);
    width: 16px;
    height: 16px;
  }
`;

export class KanbanCard extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = styles;

  private readonly clickEdit = (e: MouseEvent) => {
    e.stopPropagation();
    const selection = this.getSelection();
    if (selection) {
      openDetail(this.kanbanViewLogic, this.cardId, selection);
    }
  };

  private readonly clickMore = (e: MouseEvent) => {
    e.stopPropagation();
    const selection = this.getSelection();
    const ele = e.currentTarget as HTMLElement;
    if (selection) {
      selection.selection = {
        selectionType: 'card',
        cards: [
          {
            groupKey: this.groupKey,
            cardId: this.cardId,
          },
        ],
      };
      popCardMenu(
        this.kanbanViewLogic,
        popupTargetFromElement(ele),
        this.cardId,
        selection
      );
    }
  };

  private readonly contextMenu = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const selection = this.getSelection();
    if (selection) {
      selection.selection = {
        selectionType: 'card',
        cards: [
          {
            groupKey: this.groupKey,
            cardId: this.cardId,
          },
        ],
      };
      const target = e.target as HTMLElement;
      const ref = target.closest('notesgraph-data-view-kanban-cell') ?? this;
      popCardMenu(
        this.kanbanViewLogic,
        popupTargetFromElement(ref),
        this.cardId,
        selection
      );
    }
  };

  private getSelection() {
    return this.kanbanViewLogic.selectionController;
  }

  private renderBody(columns: KanbanColumn[]) {
    if (columns.length === 0) {
      return '';
    }
    return html` <div class="card-body">
      ${repeat(
        columns,
        v => v.id,
        column => {
          if (this.view.isInHeader(column.id)) {
            return '';
          }
          return html` <notesgraph-data-view-kanban-cell
            .contentOnly="${false}"
            data-column-id="${column.id}"
            .groupKey="${this.groupKey}"
            .column="${column}"
            .cardId="${this.cardId}"
            .kanbanViewLogic="${this.kanbanViewLogic}"
          ></notesgraph-data-view-kanban-cell>`;
        }
      )}
    </div>`;
  }

  private renderHeader(columns: KanbanColumn[]) {
    if (!this.view.hasHeader(this.cardId)) {
      return '';
    }
    const classList = classMap({
      'card-header': true,
      'has-divider': columns.length > 0,
    });
    return html`
      <div class="${classList}">
        ${this.renderBadges()} ${this.renderTitle()} ${this.renderIcon()}
      </div>
    `;
  }

  private childrenSource() {
    return this.view.manager.dataSource as {
      cardBadge?: (rowId: string) => { label: string; color: string } | null;
      cardChildren?: (
        rowId: string
      ) => { id: string; text: string; done: boolean }[];
      toggleChildDone?: (rowId: string, childId: string) => void;
    };
  }

  /**
   * Type badge + child-progress chip. Both provided (duck-typed) by data
   * sources whose rows are org task lines — see OrgTaskRowsDataSource.
   */
  private renderBadges() {
    const dataSource = this.childrenSource();
    const badge = dataSource.cardBadge?.(this.cardId);
    const children = dataSource.cardChildren?.(this.cardId) ?? [];
    if (!badge && children.length === 0) {
      return '';
    }
    const done = children.filter(c => c.done).length;
    return html`<div class="card-badges">
      ${badge
        ? html`<div
            class="card-type-badge"
            style="color:${badge.color};background:${badge.color}22"
          >
            ${badge.label}
          </div>`
        : ''}
      ${children.length > 0
        ? html`<div class="card-progress-chip">${done}/${children.length}</div>`
        : ''}
    </div>`;
  }

  /**
   * Child tasks render inside the parent's card as mini-cards (an epic is a
   * big card containing its stories); clicking one toggles its done state.
   */
  private renderChildren() {
    const dataSource = this.childrenSource();
    const children = dataSource.cardChildren?.(this.cardId) ?? [];
    if (children.length === 0) {
      return '';
    }
    return html`<div class="card-children">
      ${repeat(
        children,
        child => child.id,
        child => html`
          <div
            class="card-child ${child.done ? 'done' : ''}"
            @click="${(e: MouseEvent) => {
              e.stopPropagation();
              dataSource.toggleChildDone?.(this.cardId, child.id);
            }}"
          >
            <div class="card-child-check">${child.done ? '✓' : ''}</div>
            <div class="card-child-text">${child.text}</div>
          </div>
        `
      )}
    </div>`;
  }

  private renderIcon() {
    const icon = this.view.getHeaderIcon(this.cardId);
    if (!icon) {
      return;
    }
    return html` <div class="card-header-icon">
      ${icon.cellGetOrCreate(this.cardId).value$.value}
    </div>`;
  }

  private renderOps() {
    if (this.view.readonly$.value) {
      return;
    }
    return html`
      <div class="card-ops">
        <div class="card-op" @click="${this.clickEdit}">
          ${CenterPeekIcon()}
        </div>
        <div class="card-op" @click="${this.clickMore}">
          ${MoreHorizontalIcon()}
        </div>
      </div>
    `;
  }

  private renderTitle() {
    const title = this.view.getHeaderTitle(this.cardId);
    if (!title) {
      return;
    }
    return html` <div class="card-header-title">
      <notesgraph-data-view-kanban-cell
        .contentOnly="${true}"
        data-column-id="${title.id}"
        .kanbanViewLogic="${this.kanbanViewLogic}"
        .groupKey="${this.groupKey}"
        .column="${title}"
        .cardId="${this.cardId}"
      ></notesgraph-data-view-kanban-cell>
    </div>`;
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.view.readonly$.value) {
      return;
    }
    this._disposables.addFromEvent(this, 'contextmenu', e => {
      this.contextMenu(e);
    });
    this._disposables.addFromEvent(this, 'click', e => {
      // Shift-click extends a contiguous range from the anchor; cmd/ctrl-click
      // toggles a single card in/out of the set (discontiguous).
      if (e.shiftKey) {
        this.getSelection()?.rangeClickCard(e);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        this.getSelection()?.toggleClickCard(e);
        return;
      }
      const selection = this.getSelection();
      // Remember this card as the anchor for a later shift range-select.
      selection?.setRangeAnchor(this.cardId, this.groupKey);
      const preSelection = selection?.selection;

      if (preSelection?.selectionType !== 'card') return;

      if (selection) {
        selection.selection = undefined;
      }
      this.kanbanViewLogic.root.openDetailPanel({
        view: this.view,
        rowId: this.cardId,
        onClose: () => {
          if (selection) {
            selection.selection = preSelection;
          }
        },
      });
    });
  }

  override render() {
    const columns = this.view.properties$.value.filter(
      v => !this.view.isInHeader(v.id)
    );
    this.style.border = this.isFocus$.value
      ? '1px solid var(--notesgraph-primary-color)'
      : '';
    return html`
      ${this.renderHeader(columns)} ${this.renderBody(columns)}
      ${this.renderChildren()} ${this.renderOps()}
    `;
  }

  @property({ attribute: false })
  accessor cardId!: string;

  @property({ attribute: false })
  accessor groupKey!: string;

  isFocus$ = signal(false);

  @property({ attribute: false })
  accessor kanbanViewLogic!: KanbanViewUILogic;

  get view() {
    return this.kanbanViewLogic.view;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-data-view-kanban-card': KanbanCard;
  }
}
