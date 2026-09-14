import { viewPresets } from '@blocksuite/data-view/view-presets';
import {
  DatabaseKanbanViewIcon,
  DatabaseTableViewIcon,
  TimelineIcon,
  TodayIcon,
} from '@blocksuite/icons/lit';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph-shared/commands';
import {
  NotificationProvider,
  TelemetryProvider,
} from '@blocksuite/notesgraph-shared/services';
import { isInsideBlockByFlavour } from '@blocksuite/notesgraph-shared/utils';
import type { BlockStdScope } from '@blocksuite/std';
import { type SlashMenuConfig } from '@blocksuite/notesgraph-widget-slash-menu';

import { insertDatabaseBlockCommand } from '../commands';
import {
  insertQueryDatabase,
  insertTaskReport,
  parseQueryTokens,
} from '../query-data-source';
import { KanbanViewTooltip, TableViewTooltip } from './tooltips';

export const databaseSlashMenuConfig: SlashMenuConfig = {
  disableWhen: ({ model }) => model.flavour === 'notesgraph:database',
  items: [
    {
      name: 'Table View',
      description: 'Display items in a table format.',
      searchAlias: ['database'],
      icon: DatabaseTableViewIcon(),
      tooltip: {
        figure: TableViewTooltip,
        caption: 'Table View',
      },
      group: '7_Database@0',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.tableViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'notesgraph:database',
              });
            }
          })
          .run();
      },
    },

    {
      name: 'Calendar View',
      description: 'Display items by date in a calendar.',
      searchAlias: ['database', 'calendar'],
      icon: TodayIcon(),
      group: '7_Database@1',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.calendarViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'notesgraph:database',
              });
            }
          })
          .run();
      },
    },

    {
      name: 'Kanban View',
      description: 'Visualize data in a dashboard.',
      searchAlias: ['database'],
      icon: DatabaseKanbanViewIcon(),
      tooltip: {
        figure: KanbanViewTooltip,
        caption: 'Kanban View',
      },
      group: '7_Database@2',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.kanbanViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'notesgraph:database',
              });
            }
          })
          .run();
      },
    },

    {
      name: 'Gantt View',
      description: 'Plan tasks on a timeline with dependencies.',
      searchAlias: ['database', 'gantt', 'timeline'],
      icon: TimelineIcon(),
      group: '7_Database@3',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.ganttViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'notesgraph:database',
              });
            }
          })
          .run();
      },
    },

    {
      name: 'Query Board',
      description: 'Kanban of every task matching #tags across the workspace.',
      searchAlias: ['database', 'kanban', 'query', 'filter', 'tasks'],
      icon: DatabaseKanbanViewIcon(),
      group: '7_Database@4',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std, model }) => {
        promptQueryFilter(std, 'Query Board').then(filter => {
          if (!filter) return;
          insertQueryDatabase(
            std.host,
            viewPresets.kanbanViewMeta.type,
            model,
            filter
          );
          std
            .getOptional(TelemetryProvider)
            ?.track('BlockCreated', { blockType: 'notesgraph:database' });
        });
      },
    },

    {
      name: 'Query Table',
      description: 'Table of every task matching #tags across the workspace.',
      searchAlias: ['database', 'query', 'filter', 'tasks'],
      icon: DatabaseTableViewIcon(),
      group: '7_Database@5',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std, model }) => {
        promptQueryFilter(std, 'Query Table').then(filter => {
          if (!filter) return;
          insertQueryDatabase(
            std.host,
            viewPresets.tableViewMeta.type,
            model,
            filter
          );
          std
            .getOptional(TelemetryProvider)
            ?.track('BlockCreated', { blockType: 'notesgraph:database' });
        });
      },
    },

    {
      name: 'Task List',
      description: 'A live list of open tasks matching #tags across the workspace.',
      searchAlias: ['database', 'query', 'list', 'tasks', 'todo'],
      icon: DatabaseTableViewIcon(),
      group: '7_Database@6',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std, model }) => {
        promptQueryFilter(std, 'Task List').then(filter => {
          if (!filter) return;
          insertQueryDatabase(
            std.host,
            viewPresets.listViewMeta.type,
            model,
            filter
          );
          std
            .getOptional(TelemetryProvider)
            ?.track('BlockCreated', { blockType: 'notesgraph:database' });
        });
      },
    },

    {
      name: 'Task Report',
      description: 'In progress / due soon / todo / done sections for a scope.',
      searchAlias: ['database', 'query', 'report', 'jira', 'dashboard'],
      icon: DatabaseTableViewIcon(),
      group: '7_Database@6',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std, model }) => {
        promptQueryFilter(std, 'Task Report').then(filter => {
          if (!filter) return;
          insertTaskReport(std.host, model, filter, {
            table: viewPresets.tableViewMeta.type,
            kanban: viewPresets.kanbanViewMeta.type,
          });
          std
            .getOptional(TelemetryProvider)
            ?.track('BlockCreated', { blockType: 'notesgraph:database' });
        });
      },
    },
  ],
};

/**
 * Asks for the board's filter tokens: whitespace/comma separated `#tag`
 * and `#key:value` entries (leading '#' optional). Resolves null on
 * cancel; an empty input means "all tasks".
 */
async function promptQueryFilter(
  std: BlockStdScope,
  title: string
): Promise<{ tags: string[]; props: string[] } | null> {
  const notification = std.getOptional(NotificationProvider);
  let input = '';
  if (notification) {
    const answer = await notification
      .prompt({
        title,
        message:
          'Filter tasks by #tags and #key:value properties (leave empty for all tasks)',
        placeholder: '#personal #project:atlas',
        confirmText: 'Create',
      })
      .catch(() => null);
    if (answer === null) return null;
    input = answer;
  }
  return parseQueryTokens(input);
}
