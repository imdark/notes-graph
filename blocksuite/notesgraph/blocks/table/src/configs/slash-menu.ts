import { TableIcon } from '@blocksuite/icons/lit';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph-shared/commands';
import { TelemetryProvider } from '@blocksuite/notesgraph-shared/services';
import { isInsideBlockByFlavour } from '@blocksuite/notesgraph-shared/utils';
import type { SlashMenuConfig } from '@blocksuite/notesgraph-widget-slash-menu';

import { insertTableBlockCommand } from '../commands';
import { tableTooltip } from './tooltips';

export const tableSlashMenuConfig: SlashMenuConfig = {
  disableWhen: ({ model }) => model.flavour === 'notesgraph:table',
  items: [
    {
      name: 'Table',
      description: 'Create a simple table.',
      icon: TableIcon(),
      tooltip: {
        figure: tableTooltip,
        caption: 'Table',
      },
      group: '4_Content & Media@0',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertTableBlockCommand, {
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedTableBlockId }) => {
            if (insertedTableBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'notesgraph:table',
              });
            }
          })
          .run();
      },
    },
  ],
};
