import type { InsertToPosition } from '@blocksuite/notesgraph-shared/utils';
import { nanoid } from '@blocksuite/store';
import { computed, type ReadonlySignal } from '@preact/signals-core';

import {
  getTagColor,
  selectOptionColors,
} from '../../core/component/tags/colors.js';
import { evalFilter } from '../../core/filter/eval.js';
import { FilterTrait, filterTraitKey } from '../../core/filter/trait.js';
import type { FilterGroup } from '../../core/filter/types.js';
import { emptyFilterGroup } from '../../core/filter/utils.js';
import { SortManager, sortTraitKey } from '../../core/sort/manager.js';
import { PropertyBase } from '../../core/view-manager/property.js';
import { type Row, RowBase } from '../../core/view-manager/row.js';
import {
  type SingleView,
  SingleViewBase,
} from '../../core/view-manager/single-view.js';
import type { ViewManager } from '../../core/view-manager/view-manager.js';
import { parseMermaidGantt } from './mermaid.js';
import type {
  GanttBar,
  GanttDependencyEdge,
  GanttStoredViewData,
  GanttZoom,
} from './types.js';

type SelectOption = { id: string; value: string; color: string };

export const DAY_MS = 24 * 60 * 60 * 1000;

export type GanttDateMapping =
  | { status: 'ready'; propertyId: string }
  | { status: 'setup'; propertyId?: string };

const toTimestamp = (date: number | Date) =>
  date instanceof Date ? date.getTime() : date;

const isValidTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];

export class GanttSingleView extends SingleViewBase<GanttStoredViewData> {
  propertiesRaw$ = computed(() => {
    return this.dataSource.properties$.value.map(id =>
      this.propertyGetOrCreate(id)
    );
  });

  properties$ = this.propertiesRaw$;

  detailProperties$ = computed(() => {
    return this.propertiesRaw$.value.filter(
      property => property.type$.value !== 'title'
    );
  });

  private readonly filter$ = computed(() => {
    return this.data$.value?.filter ?? emptyFilterGroup;
  });

  private readonly sortList$ = computed(() => {
    return this.data$.value?.sort;
  });

  private readonly sortManager = this.traitSet(
    sortTraitKey,
    new SortManager(this.sortList$, this, {
      setSortList: sortList => {
        this.dataUpdate(data => ({
          sort: {
            ...data.sort,
            ...sortList,
          },
        }));
      },
    })
  );

  filterTrait = this.traitSet(
    filterTraitKey,
    new FilterTrait(this.filter$, this, {
      filterSet: (filter: FilterGroup) => {
        this.dataUpdate(() => ({ filter }));
      },
    })
  );

  readonly$ = computed(() => {
    return this.manager.readonly$.value;
  });

  mainProperties$ = computed(() => {
    return {
      titleColumn:
        this.data$.value?.card?.titleColumnId ??
        this.propertiesRaw$.value.find(
          property => property.type$.value === 'title'
        )?.id,
    };
  });

  dateProperties$ = computed(() => {
    return this.propertiesRaw$.value.filter(
      property => property.type$.value === 'date'
    );
  });

  relationProperties$ = computed(() => {
    return this.propertiesRaw$.value.filter(
      property => property.type$.value === 'relation'
    );
  });

  private mapping(
    propertyId: string | undefined,
    type: string
  ): GanttDateMapping {
    if (
      propertyId &&
      this.dataSource.properties$.value.includes(propertyId) &&
      this.dataSource.propertyTypeGet(propertyId) === type
    ) {
      return { status: 'ready', propertyId };
    }
    return { status: 'setup', propertyId };
  }

  startDateMapping$: ReadonlySignal<GanttDateMapping> = computed(() => {
    return this.mapping(this.data$.value?.date?.startColumnId, 'date');
  });

  endDateMapping$: ReadonlySignal<GanttDateMapping> = computed(() => {
    return this.mapping(this.data$.value?.date?.endColumnId, 'date');
  });

  dependsOnMapping$: ReadonlySignal<GanttDateMapping> = computed(() => {
    return this.mapping(this.data$.value?.dependsOn?.columnId, 'relation');
  });

  zoom$: ReadonlySignal<GanttZoom> = computed(() => {
    return this.data$.value?.ui?.zoom ?? 'day';
  });

  /** Non-working weekday indices (0=Sun…6=Sat); defaults to weekends. */
  offDays$: ReadonlySignal<number[]> = computed(() => {
    const off = this.data$.value?.ui?.offDays;
    return Array.isArray(off) ? off : [0, 6];
  });

  selectProperties$ = computed(() => {
    return this.propertiesRaw$.value.filter(
      property => property.type$.value === 'select'
    );
  });

  checkboxProperties$ = computed(() => {
    return this.propertiesRaw$.value.filter(
      property => property.type$.value === 'checkbox'
    );
  });

  typeMapping$: ReadonlySignal<GanttDateMapping> = computed(() => {
    return this.mapping(this.data$.value?.type?.columnId, 'select');
  });

  parentMapping$: ReadonlySignal<GanttDateMapping> = computed(() => {
    return this.mapping(this.data$.value?.parent?.columnId, 'relation');
  });

  milestoneMapping$: ReadonlySignal<GanttDateMapping> = computed(() => {
    return this.mapping(this.data$.value?.milestone?.columnId, 'checkbox');
  });

  /** Options of the Type column, keyed by option id. */
  typeOptions$ = computed<Map<string, SelectOption>>(() => {
    const mapping = this.typeMapping$.value;
    if (mapping.status !== 'ready') return new Map();
    const data = this.propertyGetOrCreate(mapping.propertyId).data$.value as {
      options?: SelectOption[];
    };
    return new Map((data.options ?? []).map(option => [option.id, option]));
  });

  /** Per-row containment: parent, root ancestor, depth, and child flag. */
  hierarchy$ = computed<
    Map<
      string,
      { parentId?: string; rootId: string; depth: number; hasChildren: boolean }
    >
  >(() => {
    const rows = this.rows$.value;
    const live = new Set(rows.map(row => row.rowId));
    const mapping = this.parentMapping$.value;
    const rawParent = new Map<string, string>();
    if (mapping.status === 'ready') {
      for (const row of rows) {
        const parent = asStringArray(
          this.cellGetOrCreate(row.rowId, mapping.propertyId).jsonValue$.value
        ).find(id => id !== row.rowId && live.has(id));
        if (parent) rawParent.set(row.rowId, parent);
      }
    }
    const childCount = new Map<string, number>();
    for (const parent of rawParent.values()) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
    const walkUp = (id: string) => {
      let depth = 0;
      let current = id;
      const seen = new Set<string>();
      while (depth < 50) {
        const parent = rawParent.get(current);
        if (!parent || seen.has(parent)) break;
        seen.add(current);
        depth++;
        current = parent;
      }
      return { depth, rootId: current };
    };
    const result = new Map<
      string,
      { parentId?: string; rootId: string; depth: number; hasChildren: boolean }
    >();
    for (const row of rows) {
      const { depth, rootId } = walkUp(row.rowId);
      result.set(row.rowId, {
        parentId: rawParent.get(row.rowId),
        rootId,
        depth,
        hasChildren: (childCount.get(row.rowId) ?? 0) > 0,
      });
    }
    return result;
  });

  rowTypeOptionId(rowId: string): string | undefined {
    const mapping = this.typeMapping$.value;
    if (mapping.status !== 'ready') return undefined;
    const value = this.cellGetOrCreate(rowId, mapping.propertyId).jsonValue$
      .value;
    return typeof value === 'string' && value ? value : undefined;
  }

  rowTypeColor(rowId: string): string | undefined {
    const optionId = this.rowTypeOptionId(rowId);
    return optionId ? this.typeOptions$.value.get(optionId)?.color : undefined;
  }

  isMilestoneRow(rowId: string): boolean {
    const mapping = this.milestoneMapping$.value;
    if (mapping.status !== 'ready') return false;
    return (
      this.cellGetOrCreate(rowId, mapping.propertyId).jsonValue$.value === true
    );
  }

  bars$ = computed<GanttBar[]>(() => {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready') {
      return [];
    }
    const endMapping = this.endDateMapping$.value;
    const dependsMapping = this.dependsOnMapping$.value;
    const titleColumn = this.mainProperties$.value.titleColumn ?? 'title';
    const rows = this.rows$.value;
    const liveSet = new Set(rows.map(row => row.rowId));
    return rows.flatMap(row => {
      const startAt = this.cellGetOrCreate(row.rowId, startMapping.propertyId)
        .jsonValue$.value;
      if (!isValidTimestamp(startAt)) {
        return [];
      }
      const isMilestone = this.isMilestoneRow(row.rowId);
      let endAt = startAt;
      let hasExplicitEnd = false;
      // Milestones are zero-duration points; ignore any end-date value.
      if (!isMilestone && endMapping.status === 'ready') {
        const rawEnd = this.cellGetOrCreate(row.rowId, endMapping.propertyId)
          .jsonValue$.value;
        if (isValidTimestamp(rawEnd) && rawEnd >= startAt) {
          endAt = rawEnd;
          hasExplicitEnd = true;
        }
      }
      // Prefer jsonValue$ (reactive via the Text's deltas$ signal) so the bar
      // updates live when the title is edited; stringValue$ wouldn't re-fire.
      const titleCell = this.cellGetOrCreate(row.rowId, titleColumn);
      const jsonTitle = titleCell.jsonValue$.value;
      const title = (
        (typeof jsonTitle === 'string'
          ? jsonTitle
          : titleCell.stringValue$.value) ?? ''
      ).trim();
      const dependsOn =
        dependsMapping.status === 'ready'
          ? asStringArray(
              this.cellGetOrCreate(row.rowId, dependsMapping.propertyId)
                .jsonValue$.value
            ).filter(id => id !== row.rowId && liveSet.has(id))
          : [];
      return {
        rowId: row.rowId,
        title,
        startAt,
        endAt,
        hasExplicitEnd,
        isMilestone,
        dependsOn,
        canResizeRange:
          !isMilestone &&
          endMapping.status === 'ready' &&
          !this.readonly$.value,
        typeColor: this.rowTypeColor(row.rowId),
      } satisfies GanttBar;
    });
  });

  dependencies$ = computed<GanttDependencyEdge[]>(() => {
    const bars = this.bars$.value;
    const present = new Set(bars.map(bar => bar.rowId));
    const edges: GanttDependencyEdge[] = [];
    for (const bar of bars) {
      for (const from of bar.dependsOn) {
        if (present.has(from)) {
          edges.push({ fromRowId: from, toRowId: bar.rowId });
        }
      }
    }
    return edges;
  });

  get type(): string {
    return this.data$.value?.mode ?? 'gantt';
  }

  constructor(viewManager: ViewManager, viewId: string) {
    super(viewManager, viewId);
  }

  isShow(rowId: string): boolean {
    if (this.filter$.value.conditions.length) {
      const rowMap = Object.fromEntries(
        this.propertiesRaw$.value.map(column => [
          column.id,
          column.cellGetOrCreate(rowId).jsonValue$.value,
        ])
      );
      return evalFilter(this.filter$.value, rowMap);
    }
    return true;
  }

  override rowsMapping(rows: Row[]) {
    return this.sortManager.sort(super.rowsMapping(rows));
  }

  propertyGetOrCreate(propertyId: string): GanttProperty {
    return new GanttProperty(this, propertyId);
  }

  override rowGetOrCreate(rowId: string): GanttRow {
    return new GanttRow(this, rowId);
  }

  setStartDateColumn(propertyId: string) {
    this.dataUpdate(data => ({
      date: { ...data.date, startColumnId: propertyId },
    }));
  }

  setEndDateColumn(propertyId: string | undefined) {
    this.dataUpdate(data => ({
      date: { ...data.date, endColumnId: propertyId },
    }));
  }

  setDependsOnColumn(propertyId: string | undefined) {
    this.dataUpdate(() => ({
      dependsOn: { columnId: propertyId },
    }));
  }

  setZoom(zoom: GanttZoom) {
    this.dataUpdate(data => ({
      ui: { ...data.ui, zoom },
    }));
  }

  setOffDays(days: number[]) {
    const offDays = [...new Set(days)].sort((a, b) => a - b);
    this.dataUpdate(data => ({
      ui: { ...data.ui, offDays },
    }));
  }

  toggleOffDay(day: number) {
    const current = this.offDays$.value;
    this.setOffDays(
      current.includes(day) ? current.filter(d => d !== day) : [...current, day]
    );
  }

  createStartDateColumn() {
    const id = this.propertyAdd('end', { type: 'date', name: 'Start' });
    if (id) {
      this.setStartDateColumn(id);
    }
    return id;
  }

  createEndDateColumn() {
    const id = this.propertyAdd('end', { type: 'date', name: 'End' });
    if (id) {
      this.setEndDateColumn(id);
    }
    return id;
  }

  createDependsOnColumn() {
    const id = this.propertyAdd('end', {
      type: 'relation',
      name: 'Depends on',
    });
    if (id) {
      this.setDependsOnColumn(id);
    }
    return id;
  }

  setTypeColumn(propertyId: string | undefined) {
    this.dataUpdate(() => ({ type: { columnId: propertyId } }));
  }

  /** Create a Type select column seeded with Epic / Story / Task options. */
  createTypeColumn() {
    const id = this.propertyAdd('end', { type: 'select', name: 'Type' });
    if (!id) return;
    const color = (name: string) =>
      selectOptionColors.find(option => option.name === name)?.color ??
      getTagColor();
    this.propertyGetOrCreate(id).dataUpdate(() => ({
      options: [
        { id: nanoid(), value: 'Epic', color: color('Purple') },
        { id: nanoid(), value: 'Story', color: color('Blue') },
        { id: nanoid(), value: 'Task', color: color('Grey') },
      ],
    }));
    this.setTypeColumn(id);
    return id;
  }

  setParentColumn(propertyId: string | undefined) {
    this.dataUpdate(() => ({ parent: { columnId: propertyId } }));
  }

  createParentColumn() {
    const id = this.propertyAdd('end', { type: 'relation', name: 'Parent' });
    if (id) this.setParentColumn(id);
    return id;
  }

  setMilestoneColumn(propertyId: string | undefined) {
    this.dataUpdate(() => ({ milestone: { columnId: propertyId } }));
  }

  createMilestoneColumn() {
    const existing = this.checkboxProperties$.value.find(
      property => property.name$.value === 'Milestone'
    );
    if (existing) {
      this.setMilestoneColumn(existing.id);
      return existing.id;
    }
    const id = this.propertyAdd('end', { type: 'checkbox', name: 'Milestone' });
    if (id) this.setMilestoneColumn(id);
    return id;
  }

  /** Ensure a milestone (checkbox) column exists and is mapped; returns its id. */
  private ensureMilestoneColumn(): string | undefined {
    return this.milestoneMapping$.value.status === 'ready'
      ? this.milestoneMapping$.value.propertyId
      : this.createMilestoneColumn();
  }

  /** Flip a row's milestone flag, provisioning the column on first use. */
  toggleMilestone(rowId: string): boolean | undefined {
    if (this.readonly$.value) return;
    const columnId = this.ensureMilestoneColumn();
    if (!columnId) return;
    const next = !this.isMilestoneRow(rowId);
    this.cellGetOrCreate(rowId, columnId).jsonValueSet(next);
    return next;
  }

  setMilestone(rowId: string, value: boolean) {
    if (this.readonly$.value) return;
    const columnId = this.ensureMilestoneColumn();
    if (!columnId) return;
    this.cellGetOrCreate(rowId, columnId).jsonValueSet(value);
  }

  /** Add a milestone (zero-duration) row on `date`. */
  createMilestoneOnDate(date: number | Date): string | undefined {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready' || this.readonly$.value) {
      return;
    }
    const columnId = this.ensureMilestoneColumn();
    if (!columnId) return;
    const rowId = this.rowAdd('end');
    this.cellGetOrCreate(rowId, startMapping.propertyId).jsonValueSet(
      toTimestamp(date)
    );
    this.cellGetOrCreate(rowId, columnId).jsonValueSet(true);
    return rowId;
  }

  /**
   * Provision the containment ("Parent") column once a Gantt is configured, so
   * every record exposes it in the detail panel without manual setup. Runs at
   * most once per view (guarded by `ui.planningReady`); reuses an existing
   * `Parent` relation column if present.
   */
  ensurePlanningColumns() {
    if (this.readonly$.value || this.data$.value?.ui?.planningReady) return;
    if (this.startDateMapping$.value.status !== 'ready') return;
    if (this.parentMapping$.value.status !== 'ready') {
      const existing = this.relationProperties$.value.find(
        property => property.name$.value === 'Parent'
      );
      if (existing) {
        this.setParentColumn(existing.id);
      } else {
        this.createParentColumn();
      }
    }
    this.dataUpdate(data => ({ ui: { ...data.ui, planningReady: true } }));
  }

  setRowType(rowId: string, optionId: string | undefined) {
    const mapping = this.typeMapping$.value;
    if (mapping.status !== 'ready' || this.readonly$.value) return;
    const cell = this.cellGetOrCreate(rowId, mapping.propertyId);
    if (optionId) {
      cell.jsonValueSet(optionId);
    } else {
      cell.valueSet(undefined);
    }
  }

  /** Make `childId` a child of `parentId` (rejecting self/cycle links). */
  setParent(childId: string, parentId: string | undefined): boolean {
    const mapping = this.parentMapping$.value;
    if (mapping.status !== 'ready' || this.readonly$.value) return false;
    if (parentId === undefined) {
      this.cellGetOrCreate(childId, mapping.propertyId).jsonValueSet([]);
      return true;
    }
    if (parentId === childId) return false;
    // Reject if parentId is already a descendant of childId.
    const isDescendant = (id: string, ancestor: string) => {
      let current: string | undefined = id;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        if (current === ancestor) return true;
        seen.add(current);
        const node: string = current;
        const next: string | undefined = asStringArray(
          this.cellGetOrCreate(node, mapping.propertyId).jsonValue$.value
        ).find(value => value !== node);
        current = next;
      }
      return false;
    };
    if (isDescendant(parentId, childId)) return false;
    this.cellGetOrCreate(childId, mapping.propertyId).jsonValueSet([parentId]);
    return true;
  }

  /** Add a child task under `rowId`, creating the Parent column if needed. */
  addSubtask(rowId: string): string | undefined {
    if (this.readonly$.value) return;
    const parentId =
      this.parentMapping$.value.status === 'ready'
        ? this.parentMapping$.value.propertyId
        : this.createParentColumn();
    if (!parentId) return;
    const index = this.rows$.value.findIndex(row => row.rowId === rowId);
    const newId = this.rowAdd('end');
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status === 'ready') {
      const refStart = this.cellGetOrCreate(rowId, startMapping.propertyId)
        .jsonValue$.value;
      const start = isValidTimestamp(refStart) ? refStart : Date.now();
      this.cellGetOrCreate(newId, startMapping.propertyId).jsonValueSet(start);
      const endMapping = this.endDateMapping$.value;
      if (endMapping.status === 'ready') {
        this.cellGetOrCreate(newId, endMapping.propertyId).jsonValueSet(
          start + DAY_MS
        );
      }
    }
    this.cellGetOrCreate(newId, parentId).jsonValueSet([rowId]);
    if (index >= 0) this.moveRowToIndex(newId, index + 1);
    return newId;
  }

  private ensureColumn(type: string, name: string): string | undefined {
    const existing = this.propertiesRaw$.value.find(
      property => property.type$.value === type && property.name$.value === name
    );
    if (existing) {
      return existing.id;
    }
    return this.propertyAdd('end', { type, name });
  }

  /**
   * Import a Mermaid `gantt` definition: creates Start/End/Depends-on (+ Section
   * and Critical) columns as needed, one row per task with resolved dates, and
   * wires up `after …` relationships as dependency links. Returns the count.
   */
  importFromMermaid(text: string): number {
    if (this.readonly$.value) return 0;
    const { tasks, offWeekdays } = parseMermaidGantt(text);
    if (tasks.length === 0) return 0;
    if (offWeekdays.length > 0) this.setOffDays(offWeekdays);

    const titleId =
      this.mainProperties$.value.titleColumn ??
      this.propertiesRaw$.value.find(
        property => property.type$.value === 'title'
      )?.id;
    const startId =
      this.startDateMapping$.value.status === 'ready'
        ? this.startDateMapping$.value.propertyId
        : this.createStartDateColumn();
    const endId =
      this.endDateMapping$.value.status === 'ready'
        ? this.endDateMapping$.value.propertyId
        : this.createEndDateColumn();
    const dependsId =
      this.dependsOnMapping$.value.status === 'ready'
        ? this.dependsOnMapping$.value.propertyId
        : this.createDependsOnColumn();
    if (!startId || !endId) return 0;
    const sectionId = this.ensureColumn('select', 'Section');
    const critId = this.ensureColumn('checkbox', 'Critical');
    const hasMilestone = tasks.some(task => task.milestone);
    const milestoneId = hasMilestone
      ? this.milestoneMapping$.value.status === 'ready'
        ? this.milestoneMapping$.value.propertyId
        : this.createMilestoneColumn()
      : undefined;
    const hasDetails = tasks.some(task => task.description);
    const detailsId = hasDetails
      ? this.ensureColumn('rich-text', 'Details')
      : undefined;

    // Pre-create a select option per distinct section.
    const optionByName = new Map<string, string>();
    if (sectionId) {
      const sectionProp = this.propertyGetOrCreate(sectionId);
      const existing =
        (sectionProp.data$.value as { options?: SelectOption[] }).options ?? [];
      existing.forEach(option => optionByName.set(option.value, option.id));
      const added: SelectOption[] = [];
      for (const task of tasks) {
        if (task.section && !optionByName.has(task.section)) {
          const option = {
            id: nanoid(),
            value: task.section,
            color: getTagColor(),
          };
          optionByName.set(task.section, option.id);
          added.push(option);
        }
      }
      if (added.length) {
        sectionProp.dataUpdate(data => ({
          options: [
            ...((data as { options?: SelectOption[] }).options ?? []),
            ...added,
          ],
        }));
      }
    }

    const idMap = new Map<string, string>();
    for (const task of tasks) {
      const rowId = this.rowAdd('end');
      idMap.set(task.id, rowId);
      if (titleId) {
        this.propertyGetOrCreate(titleId).valueSetFromString(rowId, task.name);
      }
      if (detailsId && task.description) {
        this.propertyGetOrCreate(detailsId).valueSetFromString(
          rowId,
          task.description
        );
      }
      this.cellGetOrCreate(rowId, startId).jsonValueSet(task.start);
      this.cellGetOrCreate(rowId, endId).jsonValueSet(task.end);
      if (sectionId && task.section) {
        const optionId = optionByName.get(task.section);
        if (optionId) {
          this.cellGetOrCreate(rowId, sectionId).jsonValueSet(optionId);
        }
      }
      if (critId && task.crit) {
        this.cellGetOrCreate(rowId, critId).jsonValueSet(true);
      }
      if (milestoneId && task.milestone) {
        this.cellGetOrCreate(rowId, milestoneId).jsonValueSet(true);
      }
    }

    if (dependsId) {
      for (const task of tasks) {
        if (task.deps.length === 0) continue;
        const toRowId = idMap.get(task.id);
        if (!toRowId) continue;
        const relations = task.deps
          .map(dep => idMap.get(dep))
          .filter((id): id is string => id != null);
        if (relations.length) {
          this.cellGetOrCreate(toRowId, dependsId).jsonValueSet(relations);
        }
      }
    }

    this.setStartDateColumn(startId);
    this.setEndDateColumn(endId);
    if (dependsId) this.setDependsOnColumn(dependsId);
    return tasks.length;
  }

  /** Add a task starting on `date`; spans two days when an end column exists. */
  createTaskOnDate(date: number | Date) {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready' || this.readonly$.value) {
      return;
    }
    const rowId = this.rowAdd('end');
    const start = toTimestamp(date);
    this.cellGetOrCreate(rowId, startMapping.propertyId).jsonValueSet(start);
    const endMapping = this.endDateMapping$.value;
    if (endMapping.status === 'ready') {
      this.cellGetOrCreate(rowId, endMapping.propertyId).jsonValueSet(
        start + DAY_MS
      );
    }
    return rowId;
  }

  /**
   * Insert a new task at an insertion index (0…rowCount), inheriting the start
   * date of the row above so it lands in view, with a default one-day span when
   * an end column exists.
   */
  createTaskAtIndex(index: number): string | undefined {
    if (this.readonly$.value) return;
    const before = this.rows$.value;
    const refRow = before[index - 1] ?? before[0];
    const newId = this.rowAdd('end');
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status === 'ready') {
      const refStart = refRow
        ? this.cellGetOrCreate(refRow.rowId, startMapping.propertyId).jsonValue$
            .value
        : undefined;
      const start = isValidTimestamp(refStart) ? refStart : Date.now();
      this.cellGetOrCreate(newId, startMapping.propertyId).jsonValueSet(start);
      const endMapping = this.endDateMapping$.value;
      if (endMapping.status === 'ready') {
        this.cellGetOrCreate(newId, endMapping.propertyId).jsonValueSet(
          start + DAY_MS
        );
      }
    }
    this.moveRowToIndex(newId, index);
    return newId;
  }

  /** Give an unscheduled row a start date (and a default span if end exists). */
  scheduleRow(rowId: string, date: number | Date) {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready' || this.readonly$.value) {
      return;
    }
    const start = toTimestamp(date);
    this.cellGetOrCreate(rowId, startMapping.propertyId).jsonValueSet(start);
    const endMapping = this.endDateMapping$.value;
    if (endMapping.status === 'ready') {
      this.cellGetOrCreate(rowId, endMapping.propertyId).jsonValueSet(
        start + DAY_MS
      );
    }
  }

  /** Reorder a row to an insertion index (0…rowCount) in the current order. */
  moveRowToIndex(rowId: string, toIndex: number) {
    if (this.readonly$.value) return;
    const ids = this.rows$.value.map(row => row.rowId);
    if (!ids.includes(rowId)) return;
    let position: InsertToPosition;
    if (toIndex <= 0) {
      position = 'start';
    } else if (toIndex >= ids.length) {
      position = 'end';
    } else {
      const beforeId = ids[toIndex];
      if (!beforeId || beforeId === rowId) return;
      position = { before: true, id: beforeId };
    }
    this.rowGetOrCreate(rowId).move(position);
  }

  moveRowToDate(rowId: string, date: number | Date) {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready') {
      return;
    }
    const value = toTimestamp(date);
    const oldStartAt = this.cellGetOrCreate(rowId, startMapping.propertyId)
      .jsonValue$.value;
    const endMapping = this.endDateMapping$.value;
    if (endMapping.status === 'ready' && isValidTimestamp(oldStartAt)) {
      const oldEndAt = this.cellGetOrCreate(rowId, endMapping.propertyId)
        .jsonValue$.value;
      if (isValidTimestamp(oldEndAt) && oldEndAt >= oldStartAt) {
        this.cellGetOrCreate(rowId, endMapping.propertyId).jsonValueSet(
          value + (oldEndAt - oldStartAt)
        );
      }
    }
    this.cellGetOrCreate(rowId, startMapping.propertyId).jsonValueSet(value);
  }

  /** Drag the start edge; clamped to not pass the end (if an end is set). */
  resizeStart(rowId: string, date: number | Date) {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready' || this.readonly$.value) {
      return;
    }
    const value = toTimestamp(date);
    let upper = value;
    const endMapping = this.endDateMapping$.value;
    if (endMapping.status === 'ready') {
      const endAt = this.cellGetOrCreate(rowId, endMapping.propertyId)
        .jsonValue$.value;
      if (isValidTimestamp(endAt)) {
        upper = endAt;
      }
    }
    this.cellGetOrCreate(rowId, startMapping.propertyId).jsonValueSet(
      Math.min(value, upper)
    );
  }

  /**
   * Drag the end edge. If the view has no end-date column yet, one is created on
   * the fly so a single-day task can be given a duration by dragging.
   */
  resizeEnd(rowId: string, date: number | Date) {
    const startMapping = this.startDateMapping$.value;
    if (startMapping.status !== 'ready' || this.readonly$.value) {
      return;
    }
    const endId =
      this.endDateMapping$.value.status === 'ready'
        ? this.endDateMapping$.value.propertyId
        : this.createEndDateColumn();
    if (!endId) {
      return;
    }
    const startAt = this.cellGetOrCreate(rowId, startMapping.propertyId)
      .jsonValue$.value;
    const value = toTimestamp(date);
    const lower = isValidTimestamp(startAt) ? startAt : value;
    this.cellGetOrCreate(rowId, endId).jsonValueSet(Math.max(value, lower));
  }

  private dependsOnValueOf(rowId: string): string[] {
    const mapping = this.dependsOnMapping$.value;
    if (mapping.status !== 'ready') {
      return [];
    }
    return asStringArray(
      this.cellGetOrCreate(rowId, mapping.propertyId).jsonValue$.value
    );
  }

  /** True if making `toRowId` depend on `fromRowId` would close a cycle. */
  private wouldCreateCycle(fromRowId: string, toRowId: string): boolean {
    const visited = new Set<string>();
    const stack = [fromRowId];
    while (stack.length) {
      const current = stack.pop() as string;
      if (current === toRowId) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      stack.push(...this.dependsOnValueOf(current));
    }
    return false;
  }

  /**
   * Record that `toRowId` depends on `fromRowId` (finish-to-start). Rejected
   * for self-links, duplicates, and links that would create a cycle.
   */
  addDependency(fromRowId: string, toRowId: string): boolean {
    const mapping = this.dependsOnMapping$.value;
    if (
      mapping.status !== 'ready' ||
      this.readonly$.value ||
      fromRowId === toRowId
    ) {
      return false;
    }
    const current = this.dependsOnValueOf(toRowId);
    if (current.includes(fromRowId)) {
      return false;
    }
    if (this.wouldCreateCycle(fromRowId, toRowId)) {
      return false;
    }
    this.cellGetOrCreate(toRowId, mapping.propertyId).jsonValueSet([
      ...current,
      fromRowId,
    ]);
    return true;
  }

  removeDependency(fromRowId: string, toRowId: string) {
    const mapping = this.dependsOnMapping$.value;
    if (mapping.status !== 'ready' || this.readonly$.value) {
      return;
    }
    const current = this.dependsOnValueOf(toRowId);
    if (!current.includes(fromRowId)) {
      return;
    }
    this.cellGetOrCreate(toRowId, mapping.propertyId).jsonValueSet(
      current.filter(id => id !== fromRowId)
    );
  }
}

export class GanttProperty extends PropertyBase {
  hide$ = computed(() => false);

  constructor(view: GanttSingleView, propertyId: string) {
    super(view as SingleView, propertyId);
  }

  hideSet(_hide: boolean): void {}

  move(_position: InsertToPosition): void {}
}

export class GanttRow extends RowBase {
  constructor(
    readonly ganttView: GanttSingleView,
    rowId: string
  ) {
    super(ganttView, rowId);
  }
}
