import {
  menu,
  type MenuConfig,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph-components/context-menu';
import { computed } from '@preact/signals-core';
import { html } from 'lit/static-html.js';

import { BaseCellRenderer } from '../../core/property/index.js';
import { createFromBaseCellRenderer } from '../../core/property/renderer.js';
import { createIcon } from '../../core/utils/uni-icon.js';
import { relationCellStyle, relationChipStyle } from './cell-renderer-css.js';
import { relationPropertyModelConfig } from './define.js';

type MenuHandler = ReturnType<typeof popMenu>;

export class RelationCell extends BaseCellRenderer<string[], string[]> {
  private menuHandler?: MenuHandler;

  /** The title property used to label referenced rows. */
  titleColumnId$ = computed<string | undefined>(() => {
    const main = this.view.mainProperties$.value.titleColumn;
    if (main) return main;
    return this.view.properties$.value.find(
      property => property.type$.value === 'title'
    )?.id;
  });

  private titleOf(rowId: string): string {
    const titleColumn = this.titleColumnId$.value;
    if (!titleColumn) return 'Untitled';
    // jsonValue$ is reactive to title edits (Text deltas$); stringValue$ is not.
    const value = this.view.cellGetOrCreate(rowId, titleColumn).jsonValue$
      .value;
    return (typeof value === 'string' ? value.trim() : '') || 'Untitled';
  }

  /** Currently referenced ids, pruned to rows that still exist. */
  value$ref$ = computed<string[]>(() => {
    const value = this.value ?? [];
    const live = new Set(this.view.rows$.value.map(row => row.rowId));
    return value.filter(id => live.has(id));
  });

  private toggle(rowId: string) {
    const current = this.value ?? [];
    const next = current.includes(rowId)
      ? current.filter(id => id !== rowId)
      : [...current, rowId];
    this.valueSetImmediate(next);
  }

  private menuItems(): MenuConfig[] {
    const selfRowId = this.cell.rowId;
    const others = this.view.rows$.value.filter(row => row.rowId !== selfRowId);
    if (others.length === 0) {
      return [
        menu.group({
          name: '',
          items: [
            menu.action({
              name: 'No other rows to link',
              select: () => false,
            }),
          ],
        }),
      ];
    }
    return others.map(row =>
      menu.checkbox({
        name: this.titleOf(row.rowId),
        checked: computed(() => (this.value ?? []).includes(row.rowId)),
        select: () => {
          this.toggle(row.rowId);
          return false;
        },
      })
    );
  }

  private openMenu() {
    this.menuHandler = popMenu(popupTargetFromElement(this), {
      options: {
        title: { text: this.property.name$.value },
        items: this.menuItems(),
        onClose: () => {
          this.menuHandler = undefined;
          this.selectCurrentCell(false);
        },
      },
    });
  }

  override afterEnterEditingMode() {
    if (!this.menuHandler) {
      this.openMenu();
    }
  }

  override beforeExitEditingMode() {
    const handler = this.menuHandler;
    this.menuHandler = undefined;
    handler?.close();
  }

  override render() {
    const ids = this.value$ref$.value;
    if (ids.length === 0) {
      return html`<div class="${relationCellStyle}"></div>`;
    }
    return html`<div class="${relationCellStyle}">
      ${ids.map(
        id =>
          html`<span class="${relationChipStyle}" title="${this.titleOf(id)}"
            >${this.titleOf(id)}</span
          >`
      )}
    </div>`;
  }
}

export const relationPropertyConfig =
  relationPropertyModelConfig.createPropertyMeta({
    icon: createIcon('DualLinkIcon'),
    cellRenderer: {
      view: createFromBaseCellRenderer(RelationCell),
    },
  });
