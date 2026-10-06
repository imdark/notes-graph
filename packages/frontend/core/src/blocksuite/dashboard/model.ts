import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/notesgraph/store';

/**
 * Dashboards: a block whose children sit side by side as tiles, flowing right
 * and wrapping onto the next row, and chart widgets to put in them.
 *
 * Kept free of view code: the store extension loads these at bootstrap, for
 * doc CRUD, and must not pull the editor UI in with them.
 */

export const DashboardBlockFlavour = 'notesgraph:dashboard';
export const WidgetBlockFlavour = 'notesgraph:widget';

/** The most tiles a dashboard row holds. */
export const MAX_DASHBOARD_COLUMNS = 4;

export type DashboardBlockProps = {
  title: string;
  /** Tiles per row, 1–4. */
  columns: number;
};

export const DashboardBlockSchema = defineBlockSchema({
  flavour: DashboardBlockFlavour,
  props: (): DashboardBlockProps => ({
    title: '',
    columns: 3,
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: ['notesgraph:note'],
    // Each child is one tile. A callout makes a tile of several blocks.
    children: [
      'notesgraph:paragraph',
      'notesgraph:list',
      'notesgraph:callout',
      'notesgraph:code',
      'notesgraph:latex',
      'notesgraph:image',
      'notesgraph:bookmark',
      'notesgraph:attachment',
      'notesgraph:embed-*',
      WidgetBlockFlavour,
    ],
  },
  toModel: () => new DashboardBlockModel(),
});

export class DashboardBlockModel extends BlockModel<DashboardBlockProps> {}

/**
 * - stat: a monitor's latest value, its change and a sparkline
 * - line / bar: a monitor's readings over time
 * - tasks: this note's tasks counted by status
 */
export type WidgetKind = 'stat' | 'line' | 'bar' | 'tasks';

export type WidgetBlockProps = {
  kind: WidgetKind;
  /** Shown above the chart; the monitor's name when empty. */
  title: string;
  /** The monitor a stat, line or bar widget charts. */
  monitorId: string | null;
  /** How many of the latest readings to chart. */
  points: number;
  /** Tiles it spans in a dashboard row. */
  span: number;
};

export const WidgetBlockSchema = defineBlockSchema({
  flavour: WidgetBlockFlavour,
  props: (): WidgetBlockProps => ({
    kind: 'stat',
    title: '',
    monitorId: null,
    points: 30,
    span: 1,
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: ['notesgraph:note', DashboardBlockFlavour],
    children: [],
  },
  toModel: () => new WidgetBlockModel(),
});

export class WidgetBlockModel extends BlockModel<WidgetBlockProps> {}

export const DashboardBlockSchemaExtension =
  BlockSchemaExtension(DashboardBlockSchema);
export const WidgetBlockSchemaExtension =
  BlockSchemaExtension(WidgetBlockSchema);
