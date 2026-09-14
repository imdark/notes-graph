import {
  BaseCellRenderer,
  createFromBaseCellRenderer,
  createIcon,
} from '@blocksuite/data-view';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph-components/context-menu';
import { css } from '@emotion/css';
import { html } from 'lit';

import { formulaPropertyModelConfig } from './define.js';

const formulaCellStyle = css({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: '100%',
});

const valueStyle = css({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const errorStyle = css({
  color: 'var(--notesgraph-error-color, #eb4335)',
  fontStyle: 'italic',
});

const emptyStyle = css({
  color: 'var(--notesgraph-placeholder-color)',
  fontStyle: 'italic',
});

/**
 * Read-only computed cell. The column's expression is edited by clicking
 * any of its cells (the cell itself has nothing to type into), which pops
 * an inline expression editor writing to the column's property data.
 */
export class FormulaCell extends BaseCellRenderer<
  string | number | boolean | null,
  string | number | boolean | null,
  { expression: string }
> {
  private readonly openExpressionEditor = (e: MouseEvent) => {
    if (this.readonly) return;
    e.stopPropagation();
    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          menu.input({
            initialValue: this.cell.property.data$.value.expression ?? '',
            placeholder: "e.g. daysUntil([Deadline]) + ' days'",
            onComplete: expression => {
              this.cell.property.dataUpdate(() => ({ expression }));
            },
          }),
        ],
      },
    });
  };

  override beforeEnterEditMode() {
    return false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add(formulaCellStyle);
  }

  override render() {
    const value = this.value;
    const expression = this.cell.property.data$.value.expression ?? '';
    if (typeof value === 'string' && value.startsWith('#ERR')) {
      return html`<div
        class="${valueStyle} ${errorStyle}"
        title="${value}"
        @click="${this.openExpressionEditor}"
      >
        #ERR
      </div>`;
    }
    if (!expression) {
      return html`<div
        class="${valueStyle} ${emptyStyle}"
        @click="${this.openExpressionEditor}"
      >
        ${this.readonly ? '' : 'Set formula…'}
      </div>`;
    }
    return html`<div
      class="${valueStyle}"
      @click="${this.openExpressionEditor}"
    >
      ${value == null ? '' : String(value)}
    </div>`;
  }
}

export const formulaColumnConfig = formulaPropertyModelConfig.createPropertyMeta(
  {
    icon: createIcon('NumberIcon'),
    cellRenderer: {
      view: createFromBaseCellRenderer(FormulaCell),
    },
  }
);
