import { Point, Rect } from '@blocksuite/global/gfx';
import type { InsertToPosition } from '@blocksuite/notesgraph-shared/utils';
import { computed } from '@preact/signals-core';
import type { ReactiveController } from 'lit';

import { autoScrollOnBoundary } from '../../../../core/utils/auto-scroll.js';
import { startDrag } from '../../../../core/utils/drag.js';
import { KanbanCard } from '../card.js';
import { KanbanGroup } from '../group.js';
import type { KanbanViewUILogic } from '../kanban-view-ui-logic.js';

export class KanbanDragController implements ReactiveController {
  dragStart = (ele: KanbanCard, evt: PointerEvent) => {
    const host = this.host;
    if (!host) {
      return;
    }
    const currentGroup = ele.closest('notesgraph-data-view-kanban-group');
    // If the grabbed card belongs to a multi-card selection, drag the whole
    // set together (each card keeps its own source group so a cross-column
    // selection moves correctly); otherwise just the grabbed card.
    const selection = this.logic.selectionController.selection;
    const draggedCards: { cardId: string; groupKey: string }[] =
      selection?.selectionType === 'card' &&
      selection.cards.some(card => card.cardId === ele.cardId)
        ? selection.cards.map(card => ({
            cardId: card.cardId,
            groupKey: card.groupKey,
          }))
        : [{ cardId: ele.cardId, groupKey: currentGroup?.group.key ?? '' }];
    const eleRect = ele.getBoundingClientRect();
    const offsetLeft = evt.x - eleRect.left;
    const offsetTop = evt.y - eleRect.top;
    const preview = createDragPreview(
      ele,
      evt.x - offsetLeft,
      evt.y - offsetTop,
      draggedCards.length
    );
    const drag = startDrag<
      | { type: 'out'; callback: () => void }
      | {
          type: 'self';
          key: string;
          position: InsertToPosition;
        }
      | undefined,
      PointerEvent
    >(evt, {
      onDrag: () => undefined,
      onMove: evt => {
        if (!(evt.target instanceof HTMLElement)) {
          return;
        }
        preview.display(evt.x - offsetLeft, evt.y - offsetTop);
        if (!Rect.fromDOM(host).isPointIn(Point.from(evt))) {
          const callback = this.logic.root.config.onDrag;
          if (callback) {
            this.dropPreview.remove();
            return {
              type: 'out',
              callback: callback(evt, ele.cardId),
            };
          }
          return;
        }
        const result = this.showIndicator(evt, ele);
        if (result) {
          return {
            type: 'self',
            key: result.group.group.key,
            position: result.position,
          };
        }
        return;
      },
      onClear: () => {
        preview.remove();
        this.dropPreview.remove();
        cancelScroll();
      },
      onDrop: result => {
        if (!result) {
          return;
        }
        if (result.type === 'out') {
          result.callback();
          return;
        }
        if (result && currentGroup) {
          // Insert every dragged card contiguously at the drop position, in
          // selection order: moving each card to the same `before` target lands
          // the next one right after the previous, preserving order.
          for (const card of draggedCards) {
            currentGroup.group.manager.moveCardTo(
              card.cardId,
              card.groupKey,
              result.key,
              result.position
            );
          }
        }
      },
    });
    const cancelScroll =
      this.scrollContainer != null
        ? autoScrollOnBoundary(
            this.scrollContainer,
            computed(() => {
              return {
                left: drag.mousePosition.value.x,
                right: drag.mousePosition.value.x,
                top: drag.mousePosition.value.y,
                bottom: drag.mousePosition.value.y,
              };
            })
          )
        : () => {};
  };

  get host() {
    return this.logic.ui$.value;
  }

  dropPreview = createDropPreview();

  getInsertPosition = (
    evt: MouseEvent
  ):
    | { group: KanbanGroup; card?: KanbanCard; position: InsertToPosition }
    | undefined => {
    const eles = document.elementsFromPoint(evt.x, evt.y);
    const target = eles.find(v => v instanceof KanbanGroup) as KanbanGroup;
    if (target) {
      const card = getCardByPoint(target, evt.y);
      return {
        group: target,
        card,
        position: card
          ? {
              before: true,
              id: card.cardId,
            }
          : 'end',
      };
    } else {
      return;
    }
  };

  showIndicator = (
    evt: MouseEvent,
    self: KanbanCard | undefined
  ): { group: KanbanGroup; position: InsertToPosition } | undefined => {
    const position = this.getInsertPosition(evt);
    if (position) {
      this.dropPreview.display(position.group, self, position.card);
    } else {
      this.dropPreview.remove();
    }
    return position;
  };

  get scrollContainer() {
    const scrollContainer = this.logic.scrollContainer$.value;
    return scrollContainer;
  }

  constructor(private readonly logic: KanbanViewUILogic) {}

  hostConnected() {
    if (this.logic.view.readonly$.value) {
      return;
    }
    if (this.host) {
      this.host.disposables.add(
        this.logic.handleEvent('dragStart', context => {
          const event = context.get('pointerState').raw;
          const target = event.target;
          if (target instanceof Element) {
            const cell = target.closest('notesgraph-data-view-kanban-cell');
            if (cell?.isEditing$.value) {
              return;
            }
            cell?.selectCurrentCell(false);
            const card = target.closest('notesgraph-data-view-kanban-card');
            if (card) {
              this.dragStart(card, event);
            }
          }
          return true;
        })
      );
    }
  }
}

const createDragPreview = (
  card: KanbanCard,
  x: number,
  y: number,
  count = 1
) => {
  const preOpacity = card.style.opacity;
  card.style.opacity = '0.5';
  const div = document.createElement('div');
  const kanbanCard = new KanbanCard();
  kanbanCard.cardId = card.cardId;
  kanbanCard.kanbanViewLogic = card.kanbanViewLogic;
  kanbanCard.isFocus$.value = true;
  kanbanCard.style.backgroundColor =
    'var(--notesgraph-background-primary-color)';
  div.append(kanbanCard);
  div.className = 'with-data-view-css-variable';
  div.style.width = `${card.getBoundingClientRect().width}px`;
  div.style.position = 'fixed';
  div.style.pointerEvents = 'none';
  div.style.transform = 'rotate(-3deg)';
  div.style.left = `${x}px`;
  div.style.top = `${y}px`;
  div.style.zIndex = '9999';
  // When dragging a multi-selection, badge the preview with the card count.
  if (count > 1) {
    const badge = document.createElement('div');
    badge.textContent = `${count}`;
    badge.style.cssText =
      'position:absolute;top:-8px;right:-8px;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:10px;background:var(--notesgraph-primary-color);color:#fff;font-size:12px;font-weight:600;line-height:20px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.3);';
    div.append(badge);
  }
  document.body.append(div);
  return {
    display(x: number, y: number) {
      div.style.left = `${Math.round(x)}px`;
      div.style.top = `${Math.round(y)}px`;
    },
    remove() {
      card.style.opacity = preOpacity;
      div.remove();
    },
  };
};
const createDropPreview = () => {
  const div = document.createElement('div');
  div.dataset.isDropPreview = 'true';
  div.style.pointerEvents = 'none';
  div.style.position = 'fixed';
  div.style.zIndex = '9999';
  div.style.height = '3px';
  div.style.borderRadius = '2px';
  div.style.backgroundColor = 'var(--notesgraph-primary-color)';
  div.style.boxShadow = '0px 0px 8px 0px rgba(30, 150, 235, 0.35)';
  return {
    display(
      group: KanbanGroup,
      self: KanbanCard | undefined,
      card?: KanbanCard
    ) {
      if (card === self) {
        div.remove();
        return;
      }

      if (!card) {
        const cards = Array.from(
          group.querySelectorAll('notesgraph-data-view-kanban-card')
        );
        const lastCard = cards[cards.length - 1];
        if (lastCard === self) {
          div.remove();
          return;
        }
      }

      let rect: DOMRect | undefined;
      let y = 0;
      if (card) {
        rect = card.getBoundingClientRect();
        y = rect.top;
      } else {
        const addCard = group.querySelector('.add-card');
        if (addCard instanceof HTMLElement) {
          rect = addCard.getBoundingClientRect();
          y = rect.top;
        }
      }
      if (!rect) {
        const body = group.querySelector('.group-body');
        if (body instanceof HTMLElement) {
          rect = body.getBoundingClientRect();
          y = rect.bottom;
        }
      }
      if (!rect) {
        div.remove();
        return;
      }

      document.body.append(div);
      div.style.left = `${Math.round(rect.left)}px`;
      div.style.top = `${Math.round(y - 2)}px`;
      div.style.width = `${Math.round(rect.width)}px`;
    },
    remove() {
      div.remove();
    },
  };
};

const getCardByPoint = (
  group: KanbanGroup,
  y: number
): KanbanCard | undefined => {
  const cards = Array.from(
    group.querySelectorAll('notesgraph-data-view-kanban-card')
  );
  const positions = cards.map(v => {
    const rect = v.getBoundingClientRect();
    return (rect.top + rect.bottom) / 2;
  });
  const index = positions.findIndex(v => v > y);
  return cards[index];
};
