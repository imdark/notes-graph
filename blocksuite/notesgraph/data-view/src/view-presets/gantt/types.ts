import type { FilterGroup } from '../../core/filter/types.js';
import type { Sort } from '../../core/sort/types.js';
import type { BasicViewDataType } from '../../core/view/data-view.js';

export type GanttZoom = 'day' | 'week' | 'month';

type GanttViewDataShape = {
  filter: FilterGroup;
  sort?: Sort;
  date: {
    startColumnId?: string;
    endColumnId?: string;
  };
  /** The relation column whose value lists the rows a task depends on. */
  dependsOn: {
    columnId?: string;
  };
  /** The select column that classifies a task (Epic / Story / Task / …). */
  type?: {
    columnId?: string;
  };
  /** The relation column whose value is a task's containing (parent) task. */
  parent?: {
    columnId?: string;
  };
  /** The checkbox column that flags a row as a zero-duration milestone. */
  milestone?: {
    columnId?: string;
  };
  card: {
    titleColumnId?: string;
  };
  ui?: {
    zoom?: GanttZoom;
    /** Weekday indices (0=Sun…6=Sat) shaded as non-working days. */
    offDays?: number[];
    /** Set once the planning columns (e.g. Parent) have been auto-provisioned. */
    planningReady?: boolean;
  };
};

export type GanttViewData = BasicViewDataType<'gantt', GanttViewDataShape>;

export type GanttStoredViewData = GanttViewData;

/** A single task bar on the timeline. */
export type GanttBar = {
  rowId: string;
  title: string;
  startAt: number;
  /** Inclusive end day; falls back to `startAt` for single-day tasks. */
  endAt: number;
  hasExplicitEnd: boolean;
  /** A zero-duration marker (rendered as a diamond) rather than a span. */
  isMilestone: boolean;
  /** Row ids this task depends on (its predecessors). */
  dependsOn: string[];
  canResizeRange: boolean;
  /** Resolved colour of the task's Type option, used to fill the bar. */
  typeColor?: string;
};

/** A finish-to-start dependency: `fromRowId` must finish before `toRowId`. */
export type GanttDependencyEdge = {
  fromRowId: string;
  toRowId: string;
};
