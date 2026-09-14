import {
  ArrowRightBigIcon,
  DeleteIcon,
  ExpandFullIcon,
  MoveLeftIcon,
  MoveRightIcon,
} from '@blocksuite/icons/lit';
import {
  menu,
  popFilterableSimpleMenu,
  type PopupTarget,
} from '@blocksuite/notesgraph-components/context-menu';
import { html } from 'lit';

import type { KanbanSelectionController } from './controller/selection.js';
import type { KanbanViewUILogic } from './kanban-view-ui-logic.js';

export const openDetail = (
  kanbanViewLogic: KanbanViewUILogic,
  rowId: string,
  selection: KanbanSelectionController
) => {
  const old = selection.selection;
  selection.selection = undefined;
  kanbanViewLogic.root.openDetailPanel({
    view: selection.view,
    rowId: rowId,
    onClose: () => {
      selection.selection = old;
    },
  });
};

export const popCardMenu = (
  kanbanViewLogic: KanbanViewUILogic,
  ele: PopupTarget,
  rowId: string,
  selection: KanbanSelectionController
) => {
  const groups = (selection.view.groupTrait.groupsDataList$.value ?? []).filter(
    (v): v is NonNullable<typeof v> => v != null
  );
  // Data sources whose rows carry an inline task type (duck-typed — see
  // OrgTaskRowsDataSource) get a "Set type" submenu.
  const typedSource = selection.view.manager.dataSource as {
    cardTypeOptions?: () => { type: string; label: string; color: string }[];
    cardTypeOf?: (rowId: string) => string | null;
    setCardType?: (rowId: string, type: string | null) => void;
  };
  const typeItems =
    typedSource.cardTypeOptions && typedSource.setCardType
      ? [
          menu.subMenu({
            name: 'Set Type',
            prefix: html`<div
              style="width:16px;height:16px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--notesgraph-text-secondary-color)"
            >
              #
            </div>`,
            options: {
              items: [
                ...typedSource.cardTypeOptions().map(option =>
                  menu.action({
                    name: option.label,
                    isSelected:
                      typedSource.cardTypeOf?.(rowId) === option.type,
                    prefix: html`<div
                      style="width:10px;height:10px;border-radius:50%;background:${option.color}"
                    ></div>`,
                    select: () => {
                      typedSource.setCardType?.(rowId, option.type);
                    },
                  })
                ),
                menu.action({
                  name: 'No Type',
                  select: () => {
                    typedSource.setCardType?.(rowId, null);
                  },
                }),
              ],
            },
          }),
        ]
      : [];
  popFilterableSimpleMenu(ele, [
    menu.action({
      name: 'Expand Card',
      prefix: ExpandFullIcon(),
      select: () => {
        openDetail(kanbanViewLogic, rowId, selection);
      },
    }),
    ...typeItems,
    menu.subMenu({
      name: 'Move To',
      prefix: ArrowRightBigIcon(),
      options: {
        items:
          groups
            .filter(v => {
              const cardSelection = selection.selection;
              if (cardSelection?.selectionType === 'card') {
                const currentGroup = cardSelection.cards[0]?.groupKey;
                return currentGroup ? v.key !== currentGroup : true;
              }
              return false;
            })
            .map(group =>
              menu.action({
                name: group.value != null ? group.name$.value : 'Ungroup',
                select: () => {
                  selection.moveCard(rowId, group.key);
                },
              })
            ) ?? [],
      },
    }),
    menu.group({
      name: '',
      items: [
        menu.action({
          name: 'Insert Before',
          prefix: html` <div
            style="transform: rotate(90deg);display:flex;align-items:center;"
          >
            ${MoveLeftIcon()}
          </div>`,
          select: () => {
            selection.insertRowBefore();
          },
        }),
        menu.action({
          name: 'Insert After',
          prefix: html` <div
            style="transform: rotate(90deg);display:flex;align-items:center;"
          >
            ${MoveRightIcon()}
          </div>`,
          select: () => {
            selection.insertRowAfter();
          },
        }),
      ],
    }),
    menu.group({
      name: '',
      items: [
        menu.action({
          name: 'Delete Card',
          class: {
            'delete-item': true,
          },
          prefix: DeleteIcon(),
          select: () => {
            selection.deleteCard();
          },
        }),
      ],
    }),
  ]);
};
