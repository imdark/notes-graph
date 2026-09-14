import {
  DateTimeIcon,
  DiamondIcon,
  ExportToHtmlIcon,
  PlusIcon,
  TimelineIcon,
  TodayIcon,
} from '@blocksuite/icons/lit';
import {
  menu,
  type MenuConfig,
  popFilterableSimpleMenu,
  popupTargetFromElement,
} from '@blocksuite/notesgraph-components/context-menu';
import type { InsertToPosition } from '@blocksuite/notesgraph-shared/utils';
import { computed } from '@preact/signals-core';
import { html, nothing, svg, type TemplateResult } from 'lit';
import { createRef, type Ref, ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';

import { selectOptionColors } from '../../../core/component/tags/colors.js';
import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../../core/index.js';
import { stopPropagation } from '../../../core/utils/event.js';
import {
  DataViewUIBase,
  DataViewUILogicBase,
} from '../../../core/view/data-view-base.js';
import { DAY_MS, type GanttSingleView } from '../gantt-view-manager.js';
import type { GanttBar, GanttDependencyEdge, GanttZoom } from '../types.js';
import { ganttViewStyles } from './styles.js';

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 44;
const NAME_WIDTH = 200;
const ARROW_GAP = 12;
const BAR_HEIGHT = 22;
const MILESTONE_SIZE = 16;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"]/g,
    ch =>
      (
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }) as Record<
          string,
          string
        >
      )[ch] ?? ch
  );

/** Distinct, readable hues used to tint each containment group. */
const GROUP_PALETTE: string[] = [
  'Blue',
  'Green',
  'Orange',
  'Purple',
  'Teal',
  'Magenta',
  'Yellow',
  'Red',
]
  .map(name => selectOptionColors.find(color => color.name === name)?.color)
  .filter((color): color is string => Boolean(color));

const PX_PER_DAY: Record<GanttZoom, number> = {
  day: 40,
  week: 16,
  month: 6,
};

const ZOOM_PAD_DAYS: Record<GanttZoom, number> = {
  day: 2,
  week: 7,
  month: 14,
};

const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
};

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
});
const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: 'numeric',
});

type Geometry = {
  rangeStart: number;
  totalDays: number;
  pxPerDay: number;
  width: number;
};

type Tick = { x: number; label: string; major: boolean };

const dayOffset = (time: number, geo: Geometry) =>
  Math.round((startOfDay(time) - geo.rangeStart) / DAY_MS);

const buildGeometry = (bars: GanttBar[], zoom: GanttZoom): Geometry => {
  const pxPerDay = PX_PER_DAY[zoom];
  const pad = ZOOM_PAD_DAYS[zoom];
  let min: number;
  let max: number;
  if (bars.length === 0) {
    const today = startOfDay(Date.now());
    min = today - 7 * DAY_MS;
    max = today + 21 * DAY_MS;
  } else {
    min = Math.min(...bars.map(bar => bar.startAt));
    max = Math.max(...bars.map(bar => bar.endAt));
  }
  const rangeStart = startOfDay(min) - pad * DAY_MS;
  const rangeEnd = startOfDay(max) + pad * DAY_MS;
  const totalDays = Math.max(
    1,
    Math.round((rangeEnd - rangeStart) / DAY_MS) + 1
  );
  return { rangeStart, totalDays, pxPerDay, width: totalDays * pxPerDay };
};

const buildTicks = (geo: Geometry, zoom: GanttZoom): Tick[] => {
  const ticks: Tick[] = [];
  if (zoom === 'month') {
    const start = new Date(geo.rangeStart);
    const end = geo.rangeStart + geo.totalDays * DAY_MS;
    let time = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
    while (time <= end) {
      const date = new Date(time);
      ticks.push({
        x: dayOffset(time, geo) * geo.pxPerDay,
        label: monthYearFormatter.format(date),
        major: true,
      });
      time = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    }
    return ticks;
  }
  const step = zoom === 'week' ? 7 : 1;
  for (let day = 0; day < geo.totalDays; day += step) {
    const time = geo.rangeStart + day * DAY_MS;
    const date = new Date(time);
    const isMonthStart = date.getDate() === 1;
    ticks.push({
      x: day * geo.pxPerDay,
      label: isMonthStart
        ? `${monthFormatter.format(date)} ${date.getDate()}`
        : `${date.getDate()}`,
      major: isMonthStart || (zoom === 'week' && day === 0),
    });
  }
  return ticks;
};

type GanttInteraction =
  | { type: 'move'; rowId: string; offsetDays: number }
  | {
      type: 'resize';
      rowId: string;
      edge: 'start' | 'end';
      offsetDays: number;
    }
  | {
      type: 'link';
      fromRowId: string;
      pointerClientX: number;
      pointerClientY: number;
      targetRowId?: string;
    };

export class GanttViewUILogic extends DataViewUILogicBase<GanttSingleView> {
  private ui?: GanttViewUI;

  private geometry?: Geometry;

  private activeCleanup?: () => void;

  private autoScrollRaf = 0;

  private autoScrollPointer?: PointerEvent;

  private autoScrollTick?: (pointer: PointerEvent) => void;

  interaction?: GanttInteraction;

  /** Hover affordance for scheduling an unscheduled row (day-snapped left px). */
  scheduleHover?: { rowId: string; left: number };

  /** Active drag-to-reorder gesture: the row + the insertion index. */
  reorder?: { rowId: string; toIndex: number };

  /** Hovered insert boundary: the row, which edge, and the insertion index. */
  insert?: { rowId: string; edge: 'top' | 'bottom'; index: number };

  importing = false;

  innerRef: Ref<HTMLDivElement> = createRef();

  scrollRef: Ref<HTMLDivElement> = createRef();

  importTextRef: Ref<HTMLTextAreaElement> = createRef();

  clearSelection = () => {
    this.setSelection(undefined);
  };

  addRow = (position: InsertToPosition) => {
    if (this.view.readonly$.value) return;
    const rowId = this.view.rowAdd(position);
    if (rowId) {
      this.openDetail(rowId);
    }
    return rowId;
  };

  focusFirstCell = () => {};

  showIndicator = () => false;

  hideIndicator = () => {};

  moveTo = () => {};

  renderer = createUniComponentFromWebComponent(GanttViewUI);

  attach(ui: GanttViewUI) {
    this.ui = ui;
    // Provision planning columns (Parent) after mount, off the render cycle.
    requestAnimationFrame(() => this.view.ensurePlanningColumns());
  }

  detach(ui: GanttViewUI) {
    if (this.ui !== ui) return;
    this.cleanupInteraction();
    this.stopAutoScroll();
    this.interaction = undefined;
    this.ui = undefined;
  }

  syncGeometry(geo: Geometry) {
    this.geometry = geo;
  }

  get currentZoom() {
    return this.view.zoom$.value;
  }

  openDetail(rowId: string) {
    this.root.openDetailPanel({ view: this.view, rowId });
  }

  createTask() {
    if (this.view.readonly$.value) return;
    const date = this.geometry
      ? this.geometry.rangeStart + ZOOM_PAD_DAYS[this.currentZoom] * DAY_MS
      : startOfDay(Date.now());
    const rowId = this.view.createTaskOnDate(date);
    if (rowId) {
      this.openDetail(rowId);
    }
  }

  createMilestone() {
    if (this.view.readonly$.value) return;
    const date = this.geometry
      ? this.geometry.rangeStart + ZOOM_PAD_DAYS[this.currentZoom] * DAY_MS
      : startOfDay(Date.now());
    const rowId = this.view.createMilestoneOnDate(date);
    if (rowId) {
      this.openDetail(rowId);
    }
  }

  /** Track which row boundary the "insert" affordance should attach to. */
  updateInsert(rowId: string, rowIndex: number, event: MouseEvent) {
    if (this.view.readonly$.value || this.reorder || this.interaction) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const topHalf = event.clientY < rect.top + rect.height / 2;
    const edge: 'top' | 'bottom' = topHalf ? 'top' : 'bottom';
    const index = topHalf ? rowIndex : rowIndex + 1;
    if (this.insert?.rowId === rowId && this.insert.edge === edge) return;
    this.insert = { rowId, edge, index };
    this.ui?.requestUpdate();
  }

  clearInsert() {
    if (this.insert) {
      this.insert = undefined;
      this.ui?.requestUpdate();
    }
  }

  insertAtBoundary() {
    const index = this.insert?.index;
    this.insert = undefined;
    if (index === undefined || this.view.readonly$.value) {
      this.ui?.requestUpdate();
      return;
    }
    const newId = this.view.createTaskAtIndex(index);
    if (newId) this.openDetail(newId);
    this.ui?.requestUpdate();
  }

  scrollToToday() {
    const scroll = this.scrollRef.value;
    if (!scroll || !this.geometry) return;
    const x = dayOffset(Date.now(), this.geometry) * this.geometry.pxPerDay;
    scroll.scrollTo({
      left: Math.max(0, NAME_WIDTH + x - scroll.clientWidth / 2),
      behavior: 'smooth',
    });
  }

  removeDependency(edge: GanttDependencyEdge) {
    this.view.removeDependency(edge.fromRowId, edge.toRowId);
  }

  private dayIndexFromTrack(track: HTMLElement, clientX: number): number {
    if (!this.geometry) return 0;
    const x = clientX - track.getBoundingClientRect().left;
    return Math.max(0, Math.floor(x / this.geometry.pxPerDay));
  }

  onScheduleHover(rowId: string, event: MouseEvent) {
    if (this.view.readonly$.value || !this.geometry) return;
    const dayIndex = this.dayIndexFromTrack(
      event.currentTarget as HTMLElement,
      event.clientX
    );
    const left = dayIndex * this.geometry.pxPerDay;
    if (
      this.scheduleHover?.rowId === rowId &&
      this.scheduleHover.left === left
    ) {
      return;
    }
    this.scheduleHover = { rowId, left };
    this.ui?.requestUpdate();
  }

  clearScheduleHover() {
    if (this.scheduleHover) {
      this.scheduleHover = undefined;
      this.ui?.requestUpdate();
    }
  }

  scheduleAt(rowId: string, event: MouseEvent) {
    if (this.view.readonly$.value || !this.geometry) return;
    const dayIndex = this.dayIndexFromTrack(
      event.currentTarget as HTMLElement,
      event.clientX
    );
    const date = this.geometry.rangeStart + dayIndex * DAY_MS;
    this.scheduleHover = undefined;
    this.view.scheduleRow(rowId, date);
    this.ui?.requestUpdate();
  }

  private cleanupInteraction() {
    this.activeCleanup?.();
    this.activeCleanup = undefined;
  }

  /**
   * Wire document-level pointer listeners for a drag gesture and register the
   * cleanup. `onUp` runs after listeners are removed. Shared by move/resize/link.
   */
  private beginPointerGesture(
    doc: Document,
    onMove: (event: PointerEvent) => void,
    onUp: (event: PointerEvent) => void
  ) {
    const move = (event: PointerEvent) => onMove(event);
    const up = (event: PointerEvent) => {
      cleanup();
      onUp(event);
    };
    const cleanup = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      this.stopAutoScroll();
      if (this.activeCleanup === cleanup) this.activeCleanup = undefined;
    };
    this.activeCleanup = cleanup;
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  private stopAutoScroll() {
    if (this.autoScrollRaf) cancelAnimationFrame(this.autoScrollRaf);
    this.autoScrollRaf = 0;
    this.autoScrollPointer = undefined;
    this.autoScrollTick = undefined;
  }

  /**
   * While dragging near the top/bottom edge of the scroll viewport, scroll it
   * and re-run `onTick` (with the held pointer) so the drop target keeps up.
   */
  private maybeAutoScroll(
    pointer: PointerEvent,
    onTick: (pointer: PointerEvent) => void
  ) {
    const scroll = this.scrollRef.value;
    if (!scroll) return;
    this.autoScrollPointer = pointer;
    this.autoScrollTick = onTick;
    if (this.autoScrollRaf) return;

    const rect = scroll.getBoundingClientRect();
    const zone = 40;
    const speed = 16;
    const deltaFor = (p: PointerEvent) => {
      if (p.clientY < rect.top + zone) {
        return -Math.ceil((speed * (rect.top + zone - p.clientY)) / zone);
      }
      if (p.clientY > rect.bottom - zone) {
        return Math.ceil((speed * (p.clientY - (rect.bottom - zone))) / zone);
      }
      return 0;
    };
    if (deltaFor(pointer) === 0) return;

    const loop = () => {
      const p = this.autoScrollPointer;
      const delta = p ? deltaFor(p) : 0;
      if (!p || delta === 0) {
        this.stopAutoScroll();
        return;
      }
      const before = scroll.scrollTop;
      scroll.scrollTop += delta;
      if (scroll.scrollTop !== before) this.autoScrollTick?.(p);
      this.autoScrollRaf = requestAnimationFrame(loop);
    };
    this.autoScrollRaf = requestAnimationFrame(loop);
  }

  private hitTestRow(clientX: number, clientY: number): string | undefined {
    const element = this.ui?.ownerDocument.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>('[data-row-id]');
    return row?.dataset.rowId;
  }

  private reorderTargetIndex(clientY: number): number {
    const inner = this.innerRef.value;
    const count = this.view.rows$.value.length;
    if (!inner) return count;
    const top = inner.getBoundingClientRect().top + HEADER_HEIGHT;
    const index = Math.floor((clientY - top) / ROW_HEIGHT + 0.5);
    return Math.max(0, Math.min(count, index));
  }

  private setReorderTarget(rowId: string, clientY: number) {
    this.reorder = { rowId, toIndex: this.reorderTargetIndex(clientY) };
    this.ui?.requestUpdate();
  }

  /** Drag a task name vertically to reorder; a plain click opens the detail. */
  startReorder(rowId: string, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.cleanupInteraction();
    const startY = event.clientY;
    const readonly = this.view.readonly$.value;
    let dragging = false;

    this.beginPointerGesture(
      (event.currentTarget as HTMLElement).ownerDocument,
      pointer => {
        if (readonly) return;
        if (!dragging && Math.abs(pointer.clientY - startY) < 4) return;
        dragging = true;
        this.setReorderTarget(rowId, pointer.clientY);
        this.maybeAutoScroll(pointer, p =>
          this.setReorderTarget(rowId, p.clientY)
        );
      },
      () => {
        const toIndex = this.reorder?.toIndex;
        this.reorder = undefined;
        if (dragging && toIndex !== undefined) {
          this.view.moveRowToIndex(rowId, toIndex);
        } else {
          this.openDetail(rowId);
        }
        this.ui?.requestUpdate();
      }
    );
  }

  /**
   * Bar-body drag. The axis is locked on the first significant movement:
   * horizontal → reschedule (move the dates), vertical → reorder the row. A
   * plain click (no movement) opens the task detail.
   */
  startMove(rowId: string, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.cleanupInteraction();
    const bar = this.view.bars$.value.find(item => item.rowId === rowId);
    if (!bar) return;
    const pxPerDay = this.geometry?.pxPerDay ?? PX_PER_DAY.day;
    const startX = event.clientX;
    const startY = event.clientY;
    const readonly = this.view.readonly$.value;
    let mode: 'pending' | 'move' | 'reorder' = 'pending';
    let moved = false;

    this.beginPointerGesture(
      (event.currentTarget as HTMLElement).ownerDocument,
      pointer => {
        const dx = pointer.clientX - startX;
        const dy = pointer.clientY - startY;
        if (mode === 'pending') {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
          moved = true;
          if (readonly) return;
          mode = Math.abs(dy) > Math.abs(dx) ? 'reorder' : 'move';
          if (mode === 'move') {
            this.reorder = undefined;
          } else {
            this.interaction = undefined;
          }
        }
        if (mode === 'move') {
          this.interaction = {
            type: 'move',
            rowId,
            offsetDays: Math.round(dx / pxPerDay),
          };
          this.ui?.requestUpdate();
        } else if (mode === 'reorder') {
          this.setReorderTarget(rowId, pointer.clientY);
          this.maybeAutoScroll(pointer, p =>
            this.setReorderTarget(rowId, p.clientY)
          );
        }
      },
      pointer => {
        if (mode === 'move') {
          const offsetDays = Math.round((pointer.clientX - startX) / pxPerDay);
          this.interaction = undefined;
          if (offsetDays !== 0) {
            this.view.moveRowToDate(rowId, bar.startAt + offsetDays * DAY_MS);
          }
        } else if (mode === 'reorder') {
          const toIndex = this.reorder?.toIndex;
          this.reorder = undefined;
          if (toIndex !== undefined) this.view.moveRowToIndex(rowId, toIndex);
        } else if (!moved) {
          this.openDetail(rowId);
        }
        this.ui?.requestUpdate();
      }
    );
  }

  startResize(rowId: string, edge: 'start' | 'end', event: PointerEvent) {
    if (this.view.readonly$.value || !this.geometry) return;
    event.preventDefault();
    event.stopPropagation();
    this.cleanupInteraction();
    const bar = this.view.bars$.value.find(item => item.rowId === rowId);
    if (!bar) return;
    const pxPerDay = this.geometry.pxPerDay;
    const startX = event.clientX;
    this.interaction = { type: 'resize', rowId, edge, offsetDays: 0 };
    this.ui?.requestUpdate();

    this.beginPointerGesture(
      (event.currentTarget as HTMLElement).ownerDocument,
      pointer => {
        this.interaction = {
          type: 'resize',
          rowId,
          edge,
          offsetDays: Math.round((pointer.clientX - startX) / pxPerDay),
        };
        this.ui?.requestUpdate();
      },
      pointer => {
        const offsetDays = Math.round((pointer.clientX - startX) / pxPerDay);
        this.interaction = undefined;
        if (offsetDays !== 0) {
          if (edge === 'start') {
            this.view.resizeStart(rowId, bar.startAt + offsetDays * DAY_MS);
          } else {
            this.view.resizeEnd(rowId, bar.endAt + offsetDays * DAY_MS);
          }
        }
        this.ui?.requestUpdate();
      }
    );
  }

  startLink(fromRowId: string, event: PointerEvent) {
    if (
      this.view.readonly$.value ||
      this.view.dependsOnMapping$.value.status !== 'ready'
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.cleanupInteraction();
    this.interaction = {
      type: 'link',
      fromRowId,
      pointerClientX: event.clientX,
      pointerClientY: event.clientY,
    };
    this.ui?.requestUpdate();

    this.beginPointerGesture(
      (event.currentTarget as HTMLElement).ownerDocument,
      pointer => {
        const target = this.hitTestRow(pointer.clientX, pointer.clientY);
        this.interaction = {
          type: 'link',
          fromRowId,
          pointerClientX: pointer.clientX,
          pointerClientY: pointer.clientY,
          targetRowId: target && target !== fromRowId ? target : undefined,
        };
        this.ui?.requestUpdate();
      },
      pointer => {
        const target = this.hitTestRow(pointer.clientX, pointer.clientY);
        this.interaction = undefined;
        if (target && target !== fromRowId) {
          const ok = this.view.addDependency(fromRowId, target);
          if (!ok) {
            this.root.config.notification.toast(
              'Could not add dependency: it would create a cycle or already exists'
            );
          }
        }
        this.ui?.requestUpdate();
      }
    );
  }

  /** Pointer position of an active link gesture, in dependency-svg coords. */
  linkPointer(): { x: number; y: number } | undefined {
    if (this.interaction?.type !== 'link') return undefined;
    const inner = this.innerRef.value;
    if (!inner) return undefined;
    const rect = inner.getBoundingClientRect();
    return {
      x: this.interaction.pointerClientX - rect.left - NAME_WIDTH,
      y: this.interaction.pointerClientY - rect.top - HEADER_HEIGHT,
    };
  }

  private datePropertyItems(
    selected: string | undefined,
    onSelect: (id: string) => void,
    create: () => void,
    includeNone: boolean
  ): MenuConfig[] {
    const items: MenuConfig[] = [];
    if (includeNone) {
      items.push(
        menu.action({
          name: 'None',
          isSelected: !selected,
          closeOnSelect: false,
          select: () => onSelect(''),
        })
      );
    }
    items.push(
      ...this.view.dateProperties$.value.map(property =>
        menu.action({
          name: property.name$.value || 'Date',
          isSelected: property.id === selected,
          closeOnSelect: false,
          select: () => onSelect(property.id),
        })
      )
    );
    if (!this.view.readonly$.value) {
      items.push(
        menu.action({
          name: 'Create date property',
          closeOnSelect: false,
          select: create,
        })
      );
    }
    return items;
  }

  private relationPropertyItems(): MenuConfig[] {
    const selected = this.view.dependsOnMapping$.value.propertyId;
    const items: MenuConfig[] = [
      menu.action({
        name: 'None',
        isSelected: !selected,
        closeOnSelect: false,
        select: () => this.view.setDependsOnColumn(undefined),
      }),
      ...this.view.relationProperties$.value.map(property =>
        menu.action({
          name: property.name$.value || 'Relation',
          isSelected: property.id === selected,
          closeOnSelect: false,
          select: () => this.view.setDependsOnColumn(property.id),
        })
      ),
    ];
    if (!this.view.readonly$.value) {
      items.push(
        menu.action({
          name: 'Create dependency property',
          closeOnSelect: false,
          select: () => {
            this.view.createDependsOnColumn();
          },
        })
      );
    }
    return items;
  }

  private offDaysMenuItems(): MenuConfig[] {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return [
      menu.action({
        name: 'Weekends (Sat & Sun)',
        closeOnSelect: false,
        select: () => this.view.setOffDays([0, 6]),
      }),
      menu.action({
        name: 'Sundays only (6-day week)',
        closeOnSelect: false,
        select: () => this.view.setOffDays([0]),
      }),
      menu.action({
        name: 'None',
        closeOnSelect: false,
        select: () => this.view.setOffDays([]),
      }),
      ...labels.map((label, day) =>
        menu.checkbox({
          name: label,
          checked: computed(() => this.view.offDays$.value.includes(day)),
          select: () => {
            this.view.toggleOffDay(day);
            return false;
          },
        })
      ),
    ];
  }

  private columnItems(
    properties: ReadonlyArray<{ id: string; name$: { value: string } }>,
    selectedId: string | undefined,
    onSelect: (id: string | undefined) => void,
    create: () => void,
    createLabel: string
  ): MenuConfig[] {
    const items: MenuConfig[] = [
      menu.action({
        name: 'None',
        isSelected: !selectedId,
        closeOnSelect: false,
        select: () => onSelect(undefined),
      }),
      ...properties.map(property =>
        menu.action({
          name: property.name$.value || 'Field',
          isSelected: property.id === selectedId,
          closeOnSelect: false,
          select: () => onSelect(property.id),
        })
      ),
    ];
    if (!this.view.readonly$.value) {
      items.push(
        menu.action({ name: createLabel, closeOnSelect: false, select: create })
      );
    }
    return items;
  }

  /** Right-click a bar/name: set its Type or add a subtask. */
  openBarMenu(rowId: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (this.view.readonly$.value) {
      this.openDetail(rowId);
      return;
    }
    const items: MenuConfig[] = [];
    const typeMapping = this.view.typeMapping$.value;
    if (typeMapping.status === 'ready') {
      const current = this.view.rowTypeOptionId(rowId);
      items.push(
        menu.group({
          name: 'Type',
          items: [
            ...[...this.view.typeOptions$.value.values()].map(option =>
              menu.action({
                name: option.value,
                isSelected: option.id === current,
                select: () => this.view.setRowType(rowId, option.id),
              })
            ),
            menu.action({
              name: 'No type',
              isSelected: !current,
              select: () => this.view.setRowType(rowId, undefined),
            }),
          ],
        })
      );
    } else {
      items.push(
        menu.action({
          name: 'Add Type field (Epic / Story / Task)',
          select: () => {
            this.view.createTypeColumn();
          },
        })
      );
    }
    const isMilestone = this.view.isMilestoneRow(rowId);
    items.push(
      menu.group({
        name: '',
        items: [
          menu.action({
            name: isMilestone ? 'Convert to task' : 'Mark as milestone',
            prefix: DiamondIcon(),
            select: () => {
              this.view.toggleMilestone(rowId);
            },
          }),
          menu.action({
            name: 'Add subtask',
            prefix: PlusIcon(),
            select: () => {
              const id = this.view.addSubtask(rowId);
              if (id) this.openDetail(id);
            },
          }),
          menu.action({
            name: 'Open',
            select: () => this.openDetail(rowId),
          }),
        ],
      })
    );
    popFilterableSimpleMenu(
      popupTargetFromElement(event.currentTarget as HTMLElement),
      items
    );
  }

  openOptionsMenu(target: HTMLElement) {
    popFilterableSimpleMenu(popupTargetFromElement(target), [
      menu.group({
        name: 'Start date',
        items: this.datePropertyItems(
          this.view.startDateMapping$.value.propertyId,
          id => id && this.view.setStartDateColumn(id),
          () => this.view.createStartDateColumn(),
          false
        ),
      }),
      menu.group({
        name: 'End date',
        items: this.datePropertyItems(
          this.view.endDateMapping$.value.propertyId,
          id => this.view.setEndDateColumn(id || undefined),
          () => this.view.createEndDateColumn(),
          true
        ),
      }),
      menu.group({
        name: 'Depends on',
        items: this.relationPropertyItems(),
      }),
      menu.group({
        name: 'Type',
        items: this.columnItems(
          this.view.selectProperties$.value,
          this.view.typeMapping$.value.propertyId,
          id => this.view.setTypeColumn(id),
          () => this.view.createTypeColumn(),
          'Create Type field (Epic / Story / Task)'
        ),
      }),
      menu.group({
        name: 'Contains (parent)',
        items: this.columnItems(
          this.view.relationProperties$.value,
          this.view.parentMapping$.value.propertyId,
          id => this.view.setParentColumn(id),
          () => this.view.createParentColumn(),
          'Create Parent field'
        ),
      }),
      menu.group({
        name: 'Milestone',
        items: this.columnItems(
          this.view.checkboxProperties$.value,
          this.view.milestoneMapping$.value.propertyId,
          id => this.view.setMilestoneColumn(id),
          () => this.view.createMilestoneColumn(),
          'Create Milestone field'
        ),
      }),
      menu.group({
        name: 'Non-working days',
        items: this.offDaysMenuItems(),
      }),
    ]);
  }

  openSetupMenu(target: HTMLElement) {
    popFilterableSimpleMenu(
      popupTargetFromElement(target),
      this.datePropertyItems(
        this.view.startDateMapping$.value.propertyId,
        id => id && this.view.setStartDateColumn(id),
        () => this.view.createStartDateColumn(),
        false
      )
    );
  }

  toggleImport() {
    this.importing = !this.importing;
    this.ui?.requestUpdate();
  }

  cancelImport() {
    this.importing = false;
    this.ui?.requestUpdate();
  }

  runImport() {
    const text = this.importTextRef.value?.value ?? '';
    const count = this.view.importFromMermaid(text);
    if (count > 0) {
      this.importing = false;
      this.root.config.notification.toast(
        `Imported ${count} task${count === 1 ? '' : 's'} from Mermaid`
      );
    } else {
      this.root.config.notification.toast(
        'No Mermaid gantt tasks found to import'
      );
    }
    this.ui?.requestUpdate();
  }

  /** Resolve a CSS color expression (incl. theme vars) to a concrete value. */
  private resolveColor(value: string): string {
    const host = this.ui ?? document.body;
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;color:${value}`;
    host.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved || value;
  }

  /** Export the current view as a standalone, self-contained HTML document. */
  exportHtml() {
    this.download(this.buildExportHtml(), 'html', 'text/html;charset=utf-8');
  }

  /**
   * Export the current view as a Mermaid `gantt` definition. Parents are written
   * as plain `%%` comments above each task and the remaining task details are
   * written as `%% <id>: …` note comments (which the importer reads back).
   */
  exportMermaid() {
    this.download(this.buildExportMermaid(), 'mmd', 'text/plain;charset=utf-8');
  }

  /** Pop the Export menu (HTML / Mermaid) anchored to the toolbar button. */
  openExportMenu(target: HTMLElement) {
    popFilterableSimpleMenu(popupTargetFromElement(target), [
      menu.action({ name: 'HTML', select: () => this.exportHtml() }),
      menu.action({ name: 'Mermaid', select: () => this.exportMermaid() }),
    ]);
  }

  /** Save `content` as a download named after the view with `ext`. */
  private download(content: string, ext: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(this.view.name$.value || 'gantt').replace(/[^\w.-]+/g, '-')}.${ext}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private buildExportMermaid(): string {
    const view = this.view;
    const bars = view.bars$.value;
    const rows = view.rows$.value;
    const barMap = new Map(bars.map(bar => [bar.rowId, bar]));
    const hierarchy = view.hierarchy$.value;
    const titleColumn = view.mainProperties$.value.titleColumn;
    const offDays = view.offDays$.value;

    // Stable, Mermaid-safe id per row so `after …` deps and `%% <id>:` notes
    // resolve. Only rows with a bar (a valid start date) are exportable.
    const idOf = new Map<string, string>();
    bars.forEach((bar, index) => idOf.set(bar.rowId, `t${index + 1}`));

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (ts: number) => {
      const date = new Date(ts);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    // Single-line, Mermaid-safe text (no `:` to avoid splitting task lines).
    const clean = (value: string) =>
      value.replace(/\s+/g, ' ').replace(/:/g, '-').trim();

    const titleOf = (rowId: string): string => {
      if (!titleColumn) return 'Untitled';
      const value = view.cellGetOrCreate(rowId, titleColumn).jsonValue$.value;
      const text = (typeof value === 'string' ? value : '').trim();
      return text || 'Untitled';
    };

    // Columns already represented on the task line; everything else becomes a
    // detail note comment.
    const used = new Set(
      [
        titleColumn,
        view.startDateMapping$.value.propertyId,
        view.endDateMapping$.value.propertyId,
        view.dependsOnMapping$.value.propertyId,
        view.parentMapping$.value.propertyId,
        view.milestoneMapping$.value.propertyId,
      ].filter((id): id is string => Boolean(id))
    );
    const detailProperties = view.detailProperties$.value.filter(
      property => !used.has(property.id)
    );

    const WEEKDAY_NAMES = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

    const lines: string[] = ['gantt'];
    lines.push(`    title ${clean(view.name$.value || 'Gantt')}`);
    lines.push('    dateFormat YYYY-MM-DD');
    if (offDays.length) {
      const sorted = [...offDays].sort((a, b) => a - b);
      const excludes =
        sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6
          ? 'weekends'
          : sorted.map(day => WEEKDAY_NAMES[day]).join(' ');
      lines.push(`    excludes ${excludes}`);
    }

    let currentSection: string | undefined;
    for (const row of rows) {
      const bar = barMap.get(row.rowId);
      const id = idOf.get(row.rowId);
      if (!bar || !id) continue;

      const node = hierarchy.get(row.rowId);
      const rootId = node?.rootId ?? row.rowId;
      const section = hierarchy.get(rootId)?.hasChildren
        ? clean(titleOf(rootId))
        : 'Tasks';
      if (section !== currentSection) {
        lines.push('');
        lines.push(`    section ${section}`);
        currentSection = section;
      }

      // Parent as a plain comment (Mermaid has no native nesting).
      if (node?.parentId) {
        lines.push(`    %% ${id} parent: ${clean(titleOf(node.parentId))}`);
      }

      const deps = bar.dependsOn
        .map(depRowId => idOf.get(depRowId))
        .filter((depId): depId is string => Boolean(depId));
      const tags = bar.isMilestone ? ['milestone'] : [];
      const startSpec = deps.length
        ? `after ${deps.join(' ')}`
        : fmtDate(bar.startAt);
      const parts = [...tags, id, startSpec, fmtDate(bar.endAt)];
      lines.push(
        `    ${clean(bar.title || titleOf(row.rowId))} :${parts.join(', ')}`
      );

      // Remaining detail columns as `%% <id>: …` notes (importer reads these).
      for (const property of detailProperties) {
        const text = view
          .cellGetOrCreate(row.rowId, property.id)
          .stringValue$.value?.trim();
        if (!text) continue;
        const label =
          property.name$.value === 'Details' ? '' : `${property.name$.value}: `;
        for (const part of text.split('\n')) {
          const piece = part.trim();
          if (piece) lines.push(`    %% ${id}: ${label}${piece}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  private buildExportHtml(): string {
    const view = this.view;
    const zoom = view.zoom$.value;
    const bars = view.bars$.value;
    const rows = view.rows$.value;
    const geo = buildGeometry(bars, zoom);
    const ticks = buildTicks(geo, zoom);
    const barMap = new Map(bars.map(bar => [bar.rowId, bar]));
    const hierarchy = view.hierarchy$.value;
    const titleColumn = view.mainProperties$.value.titleColumn;
    const offDays = view.offDays$.value;
    const width = geo.width;
    const rowsHeight = rows.length * ROW_HEIGHT;
    const totalHeight = HEADER_HEIGHT + rowsHeight;

    const c = {
      bg: this.resolveColor('var(--notesgraph-background-primary-color)'),
      text: this.resolveColor('var(--notesgraph-text-primary-color)'),
      text2: this.resolveColor('var(--notesgraph-text-secondary-color)'),
      border: this.resolveColor('var(--notesgraph-border-color)'),
      primary: this.resolveColor('var(--notesgraph-primary-color)'),
    };
    const resolve = (value?: string) =>
      value ? this.resolveColor(value) : undefined;

    const groupColors = new Map<string, string>();
    for (const row of rows) {
      const rootId = hierarchy.get(row.rowId)?.rootId;
      if (
        rootId &&
        hierarchy.get(rootId)?.hasChildren &&
        !groupColors.has(rootId)
      ) {
        groupColors.set(
          rootId,
          this.resolveColor(
            GROUP_PALETTE[groupColors.size % GROUP_PALETTE.length] ??
              'var(--notesgraph-primary-color)'
          )
        );
      }
    }

    const offColumns: number[] = [];
    if (offDays.length) {
      for (let d = 0; d < geo.totalDays; d++) {
        if (offDays.includes(new Date(geo.rangeStart + d * DAY_MS).getDay())) {
          offColumns.push(d);
        }
      }
    }
    const todayOffset = dayOffset(Date.now(), geo);
    const showToday = todayOffset >= 0 && todayOffset < geo.totalDays;

    const geomMap = new Map<
      string,
      { left: number; width: number; index: number }
    >();
    rows.forEach((row, index) => {
      const bar = barMap.get(row.rowId);
      if (!bar) return;
      const startIdx = dayOffset(bar.startAt, geo);
      if (bar.isMilestone) {
        geomMap.set(row.rowId, {
          left: startIdx * geo.pxPerDay + geo.pxPerDay / 2 - MILESTONE_SIZE / 2,
          width: MILESTONE_SIZE,
          index,
        });
        return;
      }
      const endIdx = dayOffset(bar.endAt, geo);
      geomMap.set(row.rowId, {
        left: startIdx * geo.pxPerDay,
        width: Math.max(
          geo.pxPerDay * 0.6,
          (endIdx - startIdx + 1) * geo.pxPerDay
        ),
        index,
      });
    });

    const rowHtml = rows
      .map(row => {
        const node = hierarchy.get(row.rowId);
        const depth = node?.depth ?? 0;
        const band = node?.rootId ? groupColors.get(node.rootId) : undefined;
        const titleValue = titleColumn
          ? view.cellGetOrCreate(row.rowId, titleColumn).jsonValue$.value
          : '';
        const title =
          (typeof titleValue === 'string' ? titleValue : '').trim() ||
          'Untitled';
        const bar = barMap.get(row.rowId);
        const rowStyle = band
          ? `background:color-mix(in srgb, ${band} 14%, transparent)`
          : '';
        const nameStyle = `padding-left:${12 + depth * 16}px;${
          band
            ? `background:color-mix(in srgb, ${band} 14%, ${c.bg});box-shadow:inset 3px 0 0 ${band};`
            : ''
        }`;
        const geom = bar ? geomMap.get(row.rowId) : undefined;
        const barColor = resolve(bar?.typeColor);
        let trackHtml = '';
        if (geom && bar?.isMilestone) {
          const markerColor = barColor || c.primary;
          trackHtml = `<div class="g-milestone" style="left:${geom.left}px"><span class="g-diamond" style="background:${markerColor}"></span><span class="g-mlabel">${escapeHtml(
            bar?.title || 'Untitled'
          )}</span></div>`;
        } else if (geom) {
          const barStyle = `left:${geom.left}px;width:${geom.width}px;${
            barColor
              ? `background:color-mix(in srgb, ${barColor} 24%, ${c.bg});border-color:${barColor};`
              : ''
          }`;
          trackHtml = `<div class="g-bar" style="${barStyle}">${escapeHtml(bar?.title || 'Untitled')}</div>`;
        }
        return `<div class="g-row" style="${rowStyle}"><div class="g-name${
          node?.hasChildren ? ' container' : ''
        }" style="${nameStyle}">${escapeHtml(title)}</div><div class="g-track">${trackHtml}</div></div>`;
      })
      .join('');

    const depPaths = view.dependencies$.value
      .map(edge => {
        const from = geomMap.get(edge.fromRowId);
        const to = geomMap.get(edge.toRowId);
        if (!from || !to) return '';
        const x2 = from.left + from.width;
        const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x1 = to.left;
        const y2 = to.index * ROW_HEIGHT + ROW_HEIGHT / 2;
        const midX = x2 + ARROW_GAP;
        const d = `M ${x2} ${y1} H ${midX} V ${y2} H ${x1 - 6}`;
        const arrow = `${x1},${y2} ${x1 - 6},${y2 - 4} ${x1 - 6},${y2 + 4}`;
        return `<path class="g-dep" d="${d}"></path><polygon class="g-arrow" points="${arrow}"></polygon>`;
      })
      .join('');

    const ticksHtml = ticks
      .map(
        tick =>
          `<div class="g-tick${tick.major ? ' major' : ''}" style="left:${tick.x}px">${escapeHtml(tick.label)}</div>`
      )
      .join('');
    const offHtml = offColumns
      .map(
        d =>
          `<div class="g-off" style="left:${NAME_WIDTH + d * geo.pxPerDay}px;width:${geo.pxPerDay}px;height:${totalHeight}px"></div>`
      )
      .join('');
    const todayHtml = showToday
      ? `<div class="g-today" style="left:${NAME_WIDTH + todayOffset * geo.pxPerDay}px;height:${totalHeight}px"></div>`
      : '';

    let legend = '';
    if (view.typeMapping$.value.status === 'ready') {
      const options = [...view.typeOptions$.value.values()];
      if (options.length) {
        legend = `<div class="g-legend">${options
          .map(
            option =>
              `<span class="g-leg"><span class="g-swatch" style="background:${resolve(option.color)}"></span>${escapeHtml(option.value)}</span>`
          )
          .join('')}</div>`;
      }
    }

    const innerWidth = NAME_WIDTH + width;
    const css = `
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${c.text};background:${c.bg}}
.g-wrap{padding:20px}
.g-title{font-size:18px;font-weight:600;margin:0 0 4px}
.g-meta{font-size:12px;color:${c.text2};margin-bottom:12px}
.g-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px;font-size:12px}
.g-leg{display:inline-flex;align-items:center;gap:5px}
.g-swatch{width:12px;height:12px;border-radius:3px;display:inline-block}
.g-scroll{overflow:auto;border:1px solid ${c.border};border-radius:8px;max-height:80vh}
.g-inner{position:relative;width:${innerWidth}px}
.g-grid{position:absolute;left:${NAME_WIDTH}px;top:${HEADER_HEIGHT}px;width:${width}px;height:${rowsHeight}px;background-image:repeating-linear-gradient(to right, color-mix(in srgb, ${c.border} 55%, transparent) 0 1px, transparent 1px ${geo.pxPerDay}px)}
.g-off{position:absolute;top:0;background:color-mix(in srgb, ${c.text} 7%, transparent)}
.g-today{position:absolute;top:0;width:0;border-left:1px dashed ${c.primary}}
.g-header{position:sticky;top:0;z-index:6;display:flex;height:${HEADER_HEIGHT}px;background:${c.bg};border-bottom:1px solid color-mix(in srgb, ${c.border} 55%, transparent)}
.g-corner{position:sticky;left:0;z-index:7;flex:0 0 ${NAME_WIDTH}px;display:flex;align-items:center;padding:0 12px;font-size:12px;font-weight:600;color:${c.text2};background:${c.bg};border-right:1px solid color-mix(in srgb, ${c.border} 55%, transparent)}
.g-ticks{position:relative;width:${width}px}
.g-tick{position:absolute;top:0;bottom:0;display:flex;align-items:center;padding-left:4px;font-size:11px;white-space:nowrap;color:${c.text2};border-left:1px solid color-mix(in srgb, ${c.border} 55%, transparent)}
.g-tick.major{color:${c.text};font-weight:600}
.g-rows{position:relative}
.g-row{display:flex;height:${ROW_HEIGHT}px;border-bottom:1px solid color-mix(in srgb, ${c.border} 55%, transparent)}
.g-name{position:sticky;left:0;z-index:5;flex:0 0 ${NAME_WIDTH}px;display:flex;align-items:center;font-size:13px;background:${c.bg};border-right:1px solid color-mix(in srgb, ${c.border} 55%, transparent);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.g-name.container{font-weight:600}
.g-track{position:relative;width:${width}px}
.g-bar{position:absolute;z-index:2;top:${(ROW_HEIGHT - BAR_HEIGHT) / 2}px;height:${BAR_HEIGHT}px;display:flex;align-items:center;padding:0 8px;border-radius:5px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:color-mix(in srgb, ${c.primary} 16%, ${c.bg});border:1px solid color-mix(in srgb, ${c.primary} 45%, transparent)}
.g-milestone{position:absolute;z-index:2;top:${(ROW_HEIGHT - MILESTONE_SIZE) / 2}px;height:${MILESTONE_SIZE}px;display:flex;align-items:center}
.g-diamond{flex:0 0 ${MILESTONE_SIZE}px;width:${MILESTONE_SIZE}px;height:${MILESTONE_SIZE}px;transform:rotate(45deg);border-radius:3px;background:${c.primary}}
.g-mlabel{margin-left:8px;font-size:12px;white-space:nowrap;color:${c.text}}
.g-deps{position:absolute;left:${NAME_WIDTH}px;top:${HEADER_HEIGHT}px;width:${width}px;height:${rowsHeight}px;overflow:visible;pointer-events:none}
.g-dep{stroke:${c.text2};stroke-width:1.5;fill:none}
.g-arrow{fill:${c.text2}}`;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(view.name$.value || 'Gantt')}</title><style>${css}</style></head>
<body><div class="g-wrap"><h1 class="g-title">${escapeHtml(view.name$.value || 'Gantt')}</h1><div class="g-meta">${rows.length} tasks · exported ${escapeHtml(new Date().toLocaleString())}</div>${legend}<div class="g-scroll"><div class="g-inner"><div class="g-grid"></div>${offHtml}${todayHtml}<div class="g-header"><div class="g-corner">Task</div><div class="g-ticks">${ticksHtml}</div></div><div class="g-rows">${rowHtml}</div><svg class="g-deps">${depPaths}</svg></div></div></div></body></html>`;
  }
}

export class GanttViewUI extends DataViewUIBase<GanttViewUILogic> {
  static override styles = ganttViewStyles;

  override connectedCallback(): void {
    super.connectedCallback();
    this.logic.attach(this);
    this.dataset['testid'] = 'dv-gantt-view';
  }

  override disconnectedCallback(): void {
    this.logic.detach(this);
    super.disconnectedCallback();
  }

  private barGeometry(bar: GanttBar, geo: Geometry) {
    let start = bar.startAt;
    let end = bar.endAt;
    const interaction = this.logic.interaction;
    if (
      interaction &&
      'rowId' in interaction &&
      interaction.rowId === bar.rowId
    ) {
      if (interaction.type === 'move') {
        start = bar.startAt + interaction.offsetDays * DAY_MS;
        end = bar.endAt + interaction.offsetDays * DAY_MS;
      } else if (interaction.type === 'resize') {
        if (interaction.edge === 'start') {
          start = Math.min(
            bar.startAt + interaction.offsetDays * DAY_MS,
            bar.endAt
          );
        } else {
          end = Math.max(
            bar.endAt + interaction.offsetDays * DAY_MS,
            bar.startAt
          );
        }
      }
    }
    const startIdx = dayOffset(start, geo);
    // A milestone is a fixed-size diamond centred on its day, not a span.
    if (bar.isMilestone) {
      return {
        left: startIdx * geo.pxPerDay + geo.pxPerDay / 2 - MILESTONE_SIZE / 2,
        width: MILESTONE_SIZE,
      };
    }
    const endIdx = dayOffset(end, geo);
    return {
      left: startIdx * geo.pxPerDay,
      width: Math.max(
        geo.pxPerDay * 0.6,
        (endIdx - startIdx + 1) * geo.pxPerDay
      ),
    };
  }

  private renderBar(bar: GanttBar, geo: Geometry): TemplateResult {
    const { left, width } = this.barGeometry(bar, geo);
    const dragging =
      this.logic.interaction?.type === 'move' &&
      this.logic.interaction.rowId === bar.rowId;
    const dependsReady =
      this.logic.view.dependsOnMapping$.value.status === 'ready';
    const readonly = this.logic.view.readonly$.value;
    const colorStyle = bar.typeColor
      ? `;background:color-mix(in srgb, ${bar.typeColor} 24%, var(--notesgraph-background-primary-color));border-color:color-mix(in srgb, ${bar.typeColor} 60%, transparent)`
      : '';
    return html`<div
      class="gantt-bar ${dragging ? 'dragging' : ''}"
      data-row-id=${bar.rowId}
      style="left:${left}px;width:${width}px${colorStyle}"
      @pointerdown=${(event: PointerEvent) =>
        this.logic.startMove(bar.rowId, event)}
      @contextmenu=${(event: MouseEvent) =>
        this.logic.openBarMenu(bar.rowId, event)}
    >
      ${readonly
        ? nothing
        : html`<span
            class="gantt-bar-handle left"
            title="Drag to change the start date"
            @pointerdown=${(event: PointerEvent) =>
              this.logic.startResize(bar.rowId, 'start', event)}
          ></span>`}
      <span class="gantt-bar-label">${bar.title || 'Untitled'}</span>
      ${readonly
        ? nothing
        : html`<span
            class="gantt-bar-handle right"
            title="Drag to change the end date"
            @pointerdown=${(event: PointerEvent) =>
              this.logic.startResize(bar.rowId, 'end', event)}
          ></span>`}
      ${dependsReady && !readonly
        ? html`<span
            class="gantt-bar-connector"
            title="Drag to another task to add a dependency"
            @pointerdown=${(event: PointerEvent) =>
              this.logic.startLink(bar.rowId, event)}
          ></span>`
        : nothing}
    </div>`;
  }

  private renderMilestone(bar: GanttBar, geo: Geometry): TemplateResult {
    const { left } = this.barGeometry(bar, geo);
    const dragging =
      this.logic.interaction?.type === 'move' &&
      this.logic.interaction.rowId === bar.rowId;
    const dependsReady =
      this.logic.view.dependsOnMapping$.value.status === 'ready';
    const readonly = this.logic.view.readonly$.value;
    const colorStyle = bar.typeColor
      ? `;--gantt-milestone-color:${bar.typeColor}`
      : '';
    return html`<div
      class="gantt-milestone ${dragging ? 'dragging' : ''}"
      data-row-id=${bar.rowId}
      style="left:${left}px${colorStyle}"
      title=${bar.title || 'Untitled'}
      @pointerdown=${(event: PointerEvent) =>
        this.logic.startMove(bar.rowId, event)}
      @contextmenu=${(event: MouseEvent) =>
        this.logic.openBarMenu(bar.rowId, event)}
    >
      <span class="gantt-milestone-marker"></span>
      <span class="gantt-milestone-label">${bar.title || 'Untitled'}</span>
      ${dependsReady && !readonly
        ? html`<span
            class="gantt-milestone-connector"
            title="Drag to another task to add a dependency"
            @pointerdown=${(event: PointerEvent) =>
              this.logic.startLink(bar.rowId, event)}
          ></span>`
        : nothing}
    </div>`;
  }

  private renderScheduleGhost(
    rowId: string,
    geo: Geometry
  ): TemplateResult | typeof nothing {
    const hover = this.logic.scheduleHover;
    if (hover?.rowId !== rowId) return nothing;
    return html`<div
      class="gantt-ghost-bar"
      style="left:${hover.left}px;width:${geo.pxPerDay}px"
      title="Click to schedule this task here"
    >
      ${PlusIcon()}
    </div>`;
  }

  private renderDependencies(
    edges: GanttDependencyEdge[],
    geom: Map<string, { left: number; width: number; index: number }>,
    geo: Geometry,
    rowsHeight: number
  ): TemplateResult {
    const paths = edges.flatMap(edge => {
      const from = geom.get(edge.fromRowId);
      const to = geom.get(edge.toRowId);
      if (!from || !to) return [];
      const x2 = from.left + from.width;
      const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x1 = to.left;
      const y2 = to.index * ROW_HEIGHT + ROW_HEIGHT / 2;
      const midX = x2 + ARROW_GAP;
      const d = `M ${x2} ${y1} H ${midX} V ${y2} H ${x1 - 6}`;
      const arrow = `${x1},${y2} ${x1 - 6},${y2 - 4} ${x1 - 6},${y2 + 4}`;
      return [
        svg`<g>
          <path
            class="gantt-dep-hit"
            d=${d}
            @click=${() => this.logic.removeDependency(edge)}
          ></path>
          <path class="gantt-dep-line" d=${d}></path>
          <polygon class="gantt-dep-arrow" points=${arrow}></polygon>
        </g>`,
      ];
    });

    const interaction = this.logic.interaction;
    const pointer = this.logic.linkPointer();
    let tempPath: ReturnType<typeof svg> | typeof nothing = nothing;
    if (interaction?.type === 'link' && pointer) {
      const from = geom.get(interaction.fromRowId);
      if (from) {
        const x2 = from.left + from.width;
        const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2;
        tempPath = svg`<path
          class="gantt-dep-temp"
          d=${`M ${x2} ${y1} L ${pointer.x} ${pointer.y}`}
        ></path>`;
      }
    }

    return html`<svg
      class="gantt-deps"
      style="left:${NAME_WIDTH}px;top:${HEADER_HEIGHT}px;width:${geo.width}px;height:${rowsHeight}px"
    >
      ${paths}${tempPath}
    </svg>`;
  }

  private renderTimeline(): TemplateResult {
    const view = this.logic.view;
    const zoom = view.zoom$.value;
    const bars = view.bars$.value;
    const geo = buildGeometry(bars, zoom);
    this.logic.syncGeometry(geo);

    const rows = view.rows$.value;
    const barMap = new Map(bars.map(bar => [bar.rowId, bar]));
    const geom = new Map<
      string,
      { left: number; width: number; index: number }
    >();
    rows.forEach((row, index) => {
      const bar = barMap.get(row.rowId);
      if (bar) {
        const { left, width } = this.barGeometry(bar, geo);
        geom.set(row.rowId, { left, width, index });
      }
    });

    const rowsHeight = rows.length * ROW_HEIGHT;
    const ticks = buildTicks(geo, zoom);
    const todayOffset = dayOffset(Date.now(), geo);
    const showToday = todayOffset >= 0 && todayOffset < geo.totalDays;
    const titleColumn = view.mainProperties$.value.titleColumn;
    const readonly = view.readonly$.value;

    // Assign each containment group (a container + its descendants) a distinct
    // tint, so the parent/child relation is visible regardless of task Type.
    const hierarchy = view.hierarchy$.value;
    const groupColors = new Map<string, string>();
    for (const row of rows) {
      const rootId = hierarchy.get(row.rowId)?.rootId;
      if (
        rootId &&
        hierarchy.get(rootId)?.hasChildren &&
        !groupColors.has(rootId)
      ) {
        groupColors.set(
          rootId,
          GROUP_PALETTE[groupColors.size % GROUP_PALETTE.length] ??
            'var(--notesgraph-primary-color)'
        );
      }
    }

    const offDays = view.offDays$.value;
    const offColumns: number[] = [];
    if (offDays.length && geo.pxPerDay >= 10) {
      for (let d = 0; d < geo.totalDays; d++) {
        if (offDays.includes(new Date(geo.rangeStart + d * DAY_MS).getDay())) {
          offColumns.push(d);
        }
      }
    }

    return html`<div
      class="gantt-inner"
      style="width:${NAME_WIDTH + geo.width}px"
      ${ref(this.logic.innerRef)}
    >
      <div
        class="gantt-grid"
        style="left:${NAME_WIDTH}px;top:${HEADER_HEIGHT}px;width:${geo.width}px;height:${rowsHeight}px;background-image:repeating-linear-gradient(to right, var(--gantt-grid-color) 0 1px, transparent 1px ${geo.pxPerDay}px)"
      ></div>
      ${offColumns.map(
        d =>
          html`<div
            class="gantt-offday"
            style="left:${NAME_WIDTH +
            d *
              geo.pxPerDay}px;top:${HEADER_HEIGHT}px;width:${geo.pxPerDay}px;height:${rowsHeight}px"
          ></div>`
      )}
      ${showToday
        ? html`<div
            class="gantt-today-line"
            style="left:${NAME_WIDTH +
            todayOffset *
              geo.pxPerDay}px;top:${HEADER_HEIGHT}px;height:${rowsHeight}px"
          ></div>`
        : nothing}
      <div class="gantt-header">
        <div class="gantt-corner">Task</div>
        <div class="gantt-ticks" style="width:${geo.width}px">
          ${offColumns.map(
            d =>
              html`<div
                class="gantt-offday"
                style="left:${d *
                geo.pxPerDay}px;top:0;width:${geo.pxPerDay}px;height:100%"
              ></div>`
          )}
          ${repeat(
            ticks,
            tick => tick.x,
            tick =>
              html`<div
                class="gantt-tick ${tick.major ? 'major' : ''}"
                style="left:${tick.x}px"
              >
                ${tick.label}
              </div>`
          )}
        </div>
      </div>
      <div class="gantt-rows" @mouseleave=${() => this.logic.clearInsert()}>
        ${repeat(
          rows,
          row => row.rowId,
          (row, rowIndex) => {
            const bar = barMap.get(row.rowId);
            // Read jsonValue$ (reactive via deltas$) so the name updates live.
            const jsonTitle = titleColumn
              ? view.cellGetOrCreate(row.rowId, titleColumn).jsonValue$.value
              : '';
            const title = typeof jsonTitle === 'string' ? jsonTitle.trim() : '';
            const schedulable = !bar && !readonly;
            const reordering = this.logic.reorder?.rowId === row.rowId;
            const insert =
              this.logic.insert?.rowId === row.rowId
                ? this.logic.insert
                : undefined;
            const node = hierarchy.get(row.rowId);
            const depth = node?.depth ?? 0;
            // Tint every row in a containment group with the group's colour.
            const band = node?.rootId
              ? groupColors.get(node.rootId)
              : undefined;
            const rowStyle = band
              ? `background:color-mix(in srgb, ${band} 16%, transparent)`
              : '';
            const nameStyle = `padding-left:${12 + depth * 16}px${
              band
                ? `;background:color-mix(in srgb, ${band} 16%, var(--notesgraph-background-primary-color));box-shadow:inset 3px 0 0 ${band}`
                : ''
            }`;
            return html`<div
              class="gantt-row ${reordering ? 'reordering' : ''}"
              data-row-id=${row.rowId}
              style="${rowStyle}"
            >
              <div
                class="gantt-row-name ${insert
                  ? 'insert-active'
                  : ''} ${node?.hasChildren ? 'is-container' : ''}"
                title="Drag to reorder · click to open · right-click for type and subtasks"
                style="${nameStyle}"
                @pointerdown=${(event: PointerEvent) =>
                  this.logic.startReorder(row.rowId, event)}
                @mousemove=${(event: MouseEvent) =>
                  this.logic.updateInsert(row.rowId, rowIndex, event)}
                @mouseleave=${() => this.logic.clearInsert()}
                @contextmenu=${(event: MouseEvent) =>
                  this.logic.openBarMenu(row.rowId, event)}
              >
                <span class="gantt-row-name-text ${title ? '' : 'is-empty'}">
                  ${title || 'Untitled'}
                </span>
                ${insert
                  ? html`<button
                      class="gantt-row-insert ${insert.edge}"
                      title="Insert task here"
                      @pointerdown=${stopPropagation}
                      @click=${() => this.logic.insertAtBoundary()}
                    >
                      ${PlusIcon()}
                    </button>`
                  : nothing}
              </div>
              ${schedulable
                ? html`<div
                    class="gantt-row-track schedulable"
                    style="width:${geo.width}px"
                    @mousemove=${(event: MouseEvent) =>
                      this.logic.onScheduleHover(row.rowId, event)}
                    @mouseleave=${() => this.logic.clearScheduleHover()}
                    @click=${(event: MouseEvent) =>
                      this.logic.scheduleAt(row.rowId, event)}
                  >
                    ${this.renderScheduleGhost(row.rowId, geo)}
                  </div>`
                : html`<div
                    class="gantt-row-track"
                    style="width:${geo.width}px"
                  >
                    ${bar
                      ? bar.isMilestone
                        ? this.renderMilestone(bar, geo)
                        : this.renderBar(bar, geo)
                      : nothing}
                  </div>`}
            </div>`;
          }
        )}
      </div>
      ${this.renderDependencies(
        view.dependencies$.value,
        geom,
        geo,
        rowsHeight
      )}
      ${this.logic.reorder
        ? html`<div
            class="gantt-drop-line"
            style="top:${HEADER_HEIGHT +
            this.logic.reorder.toIndex * ROW_HEIGHT}px;width:${NAME_WIDTH +
            geo.width}px"
          ></div>`
        : nothing}
    </div>`;
  }

  private renderToolbar(): TemplateResult {
    const zoom = this.logic.view.zoom$.value;
    const zoomButton = (value: GanttZoom, label: string) =>
      html`<button
        class="gantt-zoom-button ${zoom === value ? 'active' : ''}"
        @click=${() => this.logic.view.setZoom(value)}
      >
        ${label}
      </button>`;
    return html`<div class="gantt-toolbar">
      <div class="gantt-zoom-group">
        ${zoomButton('day', 'Day')}${zoomButton('week', 'Week')}${zoomButton(
          'month',
          'Month'
        )}
      </div>
      <button
        class="gantt-tool-button"
        @click=${() => this.logic.scrollToToday()}
      >
        ${TodayIcon()}<span>Today</span>
      </button>
      <div class="gantt-spacer"></div>
      ${this.logic.view.readonly$.value
        ? nothing
        : html`<button
              class="gantt-tool-button"
              title="Add a task"
              @click=${() => this.logic.createTask()}
            >
              ${PlusIcon()}<span>New task</span>
            </button>
            <button
              class="gantt-tool-button"
              title="Add a milestone"
              @click=${() => this.logic.createMilestone()}
            >
              ${DiamondIcon()}<span>New milestone</span>
            </button>`}
      <button
        class="gantt-tool-button"
        title="Export this view as HTML or Mermaid"
        @click=${(event: MouseEvent) =>
          this.logic.openExportMenu(event.currentTarget as HTMLElement)}
      >
        ${ExportToHtmlIcon()}<span>Export</span>
      </button>
      ${this.logic.view.readonly$.value
        ? nothing
        : html`<button
            class="gantt-tool-button ${this.logic.importing ? 'active' : ''}"
            @click=${() => this.logic.toggleImport()}
          >
            ${TimelineIcon()}<span>Import Mermaid</span>
          </button>`}
      <button
        class="gantt-tool-button"
        @click=${(event: MouseEvent) =>
          this.logic.openOptionsMenu(event.currentTarget as HTMLElement)}
      >
        ${DateTimeIcon()}<span>Fields</span>
      </button>
    </div>`;
  }

  private renderImportPanel(): TemplateResult {
    return html`<div class="gantt-import">
      <textarea
        class="gantt-import-text"
        spellcheck="false"
        placeholder=${`Paste a Mermaid \`gantt\` definition here…

Add task details with a comment line:
%% s1: Clamp torque, 50ms watchdog, enforce joint-limit policy.`}
        @keydown=${stopPropagation}
        @keyup=${stopPropagation}
        @paste=${stopPropagation}
        @copy=${stopPropagation}
        @cut=${stopPropagation}
        @pointerdown=${stopPropagation}
        @click=${stopPropagation}
        ${ref(this.logic.importTextRef)}
      ></textarea>
      <div class="gantt-import-actions">
        <span class="gantt-import-hint">
          Creates columns + one row per task. Add details per task with
          <code>%% &lt;id&gt;: text</code> comment lines.
        </span>
        <button
          class="gantt-tool-button"
          @click=${() => this.logic.cancelImport()}
        >
          Cancel
        </button>
        <button
          class="gantt-tool-button primary"
          @click=${() => this.logic.runImport()}
        >
          Import
        </button>
      </div>
    </div>`;
  }

  override render(): TemplateResult {
    const setup = this.logic.view.startDateMapping$.value.status === 'setup';
    return html`
      ${this.logic.headerWidget
        ? renderUniLit(this.logic.headerWidget, { dataViewLogic: this.logic })
        : nothing}
      <div class="gantt-shell">
        ${this.renderToolbar()}
        ${this.logic.importing && !this.logic.view.readonly$.value
          ? this.renderImportPanel()
          : nothing}
        ${setup
          ? html`<div class="gantt-setup">
              <button
                @click=${(event: MouseEvent) =>
                  this.logic.openSetupMenu(event.currentTarget as HTMLElement)}
              >
                ${TimelineIcon()}
                <span>Select or create a start date property</span>
              </button>
            </div>`
          : html`<div class="gantt-scroll" ${ref(this.logic.scrollRef)}>
              ${this.renderTimeline()}
            </div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-data-view-gantt': GanttViewUI;
  }
}
