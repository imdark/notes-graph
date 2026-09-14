import type { Text } from '@blocksuite/store';
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

import type {
  ColumnDataType,
  SerializedCells,
  ViewBasicDataType,
} from './types.js';

export type DatabaseBlockProps = {
  views: ViewBasicDataType[];
  title: Text;
  cells: SerializedCells;
  columns: Array<ColumnDataType>;
  comments?: Record<string, boolean>;
  // Collapsed like a toggle block: only the title + a ▸ chevron show, the
  // whole data view (tools, view bar, rows) is hidden until expanded.
  collapsed?: boolean;
  // When set, this database is a live mirror: its rows are the contiguous
  // run of list blocks around the anchor block `mirrorBlockId` in doc
  // `mirrorDocId`, not this block's own children. Rich-text/title edits
  // write through to the source blocks; columns and cells (keyed by source
  // block id) still live on this block.
  mirrorDocId?: string;
  mirrorBlockId?: string;
  // When set, this database is a query board: its rows are every task
  // block in the workspace matching these inline `#tag` / `#key:value`
  // tokens (lowercase, without the leading '#'), resolved live from the
  // block index. Mutually exclusive with the mirror props.
  queryTags?: string[];
  queryProps?: string[];
  // Additional query criteria, applied after index resolution: org status
  // labels the task must currently have ('Todo' | 'In Progress' | 'Done'
  // or a custom keyword; empty/undefined = any), and an upper bound on the
  // task's DEADLINE relative to now ("due within N days"; null = off,
  // since Yjs can't store undefined explicitly).
  queryStatus?: string[];
  queryDueInDays?: number | null;
  // Scope the query to the docs of one project (resolved live via the
  // ProjectsProvider to that project's docIds). Empty/undefined = every doc.
  queryProjectId?: string;
  // Inbox scope: tasks in docs that belong to NO project (the complement of
  // every project's docIds). Mutually exclusive with queryProjectId.
  queryNoProject?: boolean;
};

export class DatabaseBlockModel extends BlockModel<DatabaseBlockProps> {}

export const DatabaseBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:database',
  props: (internal): DatabaseBlockProps => ({
    views: [],
    title: internal.Text(),
    cells: Object.create(null),
    columns: [],
    comments: undefined,
    collapsed: undefined,
    mirrorDocId: undefined,
    mirrorBlockId: undefined,
    queryTags: undefined,
    queryProps: undefined,
    queryStatus: undefined,
    queryDueInDays: undefined,
    queryProjectId: undefined,
    queryNoProject: undefined,
  }),
  metadata: {
    role: 'hub',
    version: 3,
    parent: ['notesgraph:note'],
    children: ['notesgraph:paragraph', 'notesgraph:list'],
  },
  toModel: () => new DatabaseBlockModel(),
});

export const DatabaseBlockSchemaExtension =
  BlockSchemaExtension(DatabaseBlockSchema);
