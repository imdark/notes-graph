import { CloudWorkspaceIcon, ImageIcon } from '@blocksuite/icons/lit';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph-shared/commands';
import { UppyUploadProvider } from '@blocksuite/notesgraph-shared/services';
import { type SlashMenuConfig } from '@blocksuite/notesgraph-widget-slash-menu';

import { insertImagesCommand } from '../commands';
import { PhotoTooltip } from './tooltips';

export const imageSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Image',
      description: 'Insert an image.',
      icon: ImageIcon(),
      tooltip: {
        figure: PhotoTooltip,
        caption: 'Photo',
      },
      group: '4_Content & Media@1',
      when: ({ model }) =>
        model.store.schema.flavourSchemaMap.has('notesgraph:image'),
      action: ({ std }) => {
        const [success, ctx] = std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertImagesCommand, { removeEmptyLine: true })
          .run();

        if (success) ctx.insertedImageIds.catch(console.error);
      },
    },
    {
      name: 'Upload Image from Cloud',
      description: 'Insert an image from Google Drive, Dropbox, etc.',
      icon: CloudWorkspaceIcon(),
      searchAlias: ['cloud', 'drive', 'dropbox'],
      group: '4_Content & Media@1',
      when: ({ model, std }) =>
        model.store.schema.flavourSchemaMap.has('notesgraph:image') &&
        !!std.getOptional(UppyUploadProvider)?.isAvailable(),
      action: ({ std }) => {
        const [success, ctx] = std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertImagesCommand, {
            removeEmptyLine: true,
            getFiles: () =>
              std
                .getOptional(UppyUploadProvider)
                ?.openUppyUpload({ multiple: true, accept: 'image/*' }) ??
              Promise.resolve([]),
          })
          .run();

        if (success) ctx.insertedImageIds.catch(console.error);
      },
    },
  ],
};
