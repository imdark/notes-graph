import { TextSelection } from '@blocksuite/notesgraph/std';
import type { BlockModel } from '@blocksuite/notesgraph/store';
import {
  SlashMenuConfigExtension,
  type SlashMenuContext,
} from '@blocksuite/notesgraph/widgets/slash-menu';
import { html } from 'lit';

import {
  DashboardBlockFlavour,
  type WidgetBlockProps,
  WidgetBlockFlavour,
} from './model';

const GROUP = '8_Dashboard';

/**
 * Where a new block goes: after the caret's block, in the dashboard when the
 * caret is in one of its tiles (and a dashboard can't nest), otherwise in the
 * note after the top-level block holding the caret.
 */
const insertionPoint = (
  ctx: SlashMenuContext,
  flavour: string
): { parent: BlockModel; index: number } | null => {
  const blockId = ctx.std.selection.find(TextSelection)?.from.blockId;
  let model = blockId ? ctx.std.store.getBlock(blockId)?.model : undefined;
  if (!model) return null;
  for (;;) {
    const parent = ctx.std.store.getParent(model);
    if (!parent) return null;
    const accepts =
      parent.flavour === 'notesgraph:note' ||
      (parent.flavour === DashboardBlockFlavour &&
        flavour !== DashboardBlockFlavour);
    if (accepts) {
      return { parent, index: parent.children.indexOf(model) + 1 };
    }
    model = parent;
  }
};

/** The caret's block, removed if `/` was typed into an empty line. */
const dropEmptyCaretBlock = (ctx: SlashMenuContext) => {
  const blockId = ctx.std.selection.find(TextSelection)?.from.blockId;
  const model = blockId ? ctx.std.store.getBlock(blockId)?.model : undefined;
  if (
    model &&
    model.flavour === 'notesgraph:paragraph' &&
    model.text?.length === 0 &&
    model.children.length === 0
  ) {
    ctx.std.store.deleteBlock(model);
  }
};

const icon = (glyph: string) =>
  html`<div style="color: var(--notesgraph-primary-color)">${glyph}</div>`;

export const DashboardSlashMenuConfigExtension = SlashMenuConfigExtension(
  'notesgraph-dashboard',
  {
    items: (ctx: SlashMenuContext) => {
      const addWidget = (props: Partial<WidgetBlockProps>) => {
        const at = insertionPoint(ctx, WidgetBlockFlavour);
        if (!at) return;
        ctx.std.store.addBlock(WidgetBlockFlavour, props, at.parent, at.index);
        dropEmptyCaretBlock(ctx);
      };
      return [
        {
          name: 'Dashboard',
          description: 'Tiles side by side, with charts of monitors and tasks',
          icon: icon('▦'),
          searchAlias: [
            'dashboard',
            'columns',
            'grid',
            'layout',
            'side by side',
          ],
          group: `${GROUP}@0`,
          when: () => insertionPoint(ctx, DashboardBlockFlavour) !== null,
          action: () => {
            const at = insertionPoint(ctx, DashboardBlockFlavour);
            if (!at) return;
            const store = ctx.std.store;
            store.transact(() => {
              const id = store.addBlock(
                DashboardBlockFlavour,
                {},
                at.parent,
                at.index
              );
              store.addBlock(WidgetBlockFlavour, { kind: 'tasks' }, id);
              store.addBlock(WidgetBlockFlavour, { kind: 'stat' }, id);
              store.addBlock('notesgraph:paragraph', {}, id);
              dropEmptyCaretBlock(ctx);
            });
          },
        },
        {
          name: 'Chart',
          description: "A line or bar chart of a monitor's values",
          icon: icon('📈'),
          searchAlias: ['chart', 'graph', 'plot', 'widget', 'bar', 'line'],
          group: `${GROUP}@1`,
          when: () => insertionPoint(ctx, WidgetBlockFlavour) !== null,
          action: () => addWidget({ kind: 'line' }),
        },
        {
          name: 'Stat',
          description: "A monitor's latest value and how it changed",
          icon: icon('🔢'),
          searchAlias: ['stat', 'kpi', 'metric', 'number', 'widget'],
          group: `${GROUP}@2`,
          when: () => insertionPoint(ctx, WidgetBlockFlavour) !== null,
          action: () => addWidget({ kind: 'stat' }),
        },
        {
          name: 'Task chart',
          description: "This note's tasks counted by status",
          icon: icon('📊'),
          searchAlias: ['tasks', 'progress', 'status', 'chart', 'widget'],
          group: `${GROUP}@3`,
          when: () => insertionPoint(ctx, WidgetBlockFlavour) !== null,
          action: () => addWidget({ kind: 'tasks' }),
        },
      ];
    },
  }
);
