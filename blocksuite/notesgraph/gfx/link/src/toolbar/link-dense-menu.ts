import { insertLinkByQuickSearchCommand } from '@blocksuite/notesgraph-block-bookmark';
import { menu } from '@blocksuite/notesgraph-components/context-menu';
import { LinkIcon } from '@blocksuite/notesgraph-components/icons';
import { TelemetryProvider } from '@blocksuite/notesgraph-shared/services';
import type { DenseMenuBuilder } from '@blocksuite/notesgraph-widget-edgeless-toolbar';

export const buildLinkDenseMenu: DenseMenuBuilder = edgeless =>
  menu.action({
    name: 'Link',
    prefix: LinkIcon,
    select: () => {
      const [_, { insertedLinkType }] = edgeless.std.command.exec(
        insertLinkByQuickSearchCommand
      );

      insertedLinkType
        ?.then(type => {
          const flavour = type?.flavour;
          if (!flavour) return;

          edgeless.std
            .getOptional(TelemetryProvider)
            ?.track('CanvasElementAdded', {
              control: 'toolbar:general',
              page: 'whiteboard editor',
              module: 'toolbar',
              type: flavour.split(':')[1],
            });
        })
        .catch(console.error);
    },
  });
