import { FontIcon } from '@blocksuite/icons/lit';
import { focusBlockEnd } from '@blocksuite/notesgraph-shared/commands';
import { isInsideBlockByFlavour } from '@blocksuite/notesgraph-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/notesgraph-widget-slash-menu';

import { calloutTooltip } from './tooltips';

export const calloutSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Callout',
      description: 'Let your words stand out.',
      icon: FontIcon(),
      tooltip: {
        figure: calloutTooltip,
        caption: 'Callout',
      },
      searchAlias: ['callout'],
      group: '0_Basic@9',
      when: ({ model }) => {
        return !isInsideBlockByFlavour(
          model.store,
          model,
          'notesgraph:edgeless-text'
        );
      },
      action: ({ model, std }) => {
        const { store } = model;
        const parent = store.getParent(model);
        if (!parent) return;

        const index = parent.children.indexOf(model);
        if (index === -1) return;
        const calloutId = store.addBlock(
          'notesgraph:callout',
          {},
          parent,
          index + 1
        );
        if (!calloutId) return;
        const paragraphId = store.addBlock(
          'notesgraph:paragraph',
          {},
          calloutId
        );
        if (!paragraphId) return;
        std.host.updateComplete
          .then(() => {
            const paragraph = std.view.getBlock(paragraphId);
            if (!paragraph) return;
            std.command.exec(focusBlockEnd, {
              focusBlock: paragraph,
            });
          })
          .catch(console.error);
      },
    },
  ],
};
