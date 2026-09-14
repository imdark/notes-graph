import {
  CloudWorkspaceIcon,
  ExportToPdfIcon,
  FileIcon,
} from '@blocksuite/icons/lit';
import { UppyUploadProvider } from '@blocksuite/notesgraph-shared/services';
import { openSingleFileWith } from '@blocksuite/notesgraph-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/notesgraph-widget-slash-menu';

import { addSiblingAttachmentBlocks } from '../utils';
import { AttachmentTooltip, PDFTooltip } from './tooltips';

export const attachmentSlashMenuConfig: SlashMenuConfig = {
  items: [
    {
      name: 'Attachment',
      description: 'Attach a file to document.',
      icon: FileIcon(),
      tooltip: {
        figure: AttachmentTooltip,
        caption: 'Attachment',
      },
      searchAlias: ['file'],
      group: '4_Content & Media@3',
      when: ({ model }) =>
        model.store.schema.flavourSchemaMap.has('notesgraph:attachment'),
      action: ({ std, model }) => {
        (async () => {
          const file = await openSingleFileWith();
          if (!file) return;

          await addSiblingAttachmentBlocks(std, [file], model);
          if (model.text?.length === 0) {
            std.store.deleteBlock(model);
          }
        })().catch(console.error);
      },
    },
    {
      name: 'Upload from Cloud',
      description: 'Attach a file from Google Drive, Dropbox, etc.',
      icon: CloudWorkspaceIcon(),
      searchAlias: ['cloud', 'drive', 'dropbox'],
      group: '4_Content & Media@3',
      when: ({ model, std }) =>
        model.store.schema.flavourSchemaMap.has('notesgraph:attachment') &&
        !!std.getOptional(UppyUploadProvider)?.isAvailable(),
      action: ({ std, model }) => {
        (async () => {
          const files = await std
            .getOptional(UppyUploadProvider)
            ?.openUppyUpload({ multiple: true });
          if (!files?.length) return;

          await addSiblingAttachmentBlocks(std, files, model);
          if (model.text?.length === 0) {
            std.store.deleteBlock(model);
          }
        })().catch(console.error);
      },
    },
    {
      name: 'PDF',
      description: 'Upload a PDF to document.',
      icon: ExportToPdfIcon(),
      tooltip: {
        figure: PDFTooltip,
        caption: 'PDF',
      },
      group: '4_Content & Media@4',
      when: ({ model }) =>
        model.store.schema.flavourSchemaMap.has('notesgraph:attachment'),
      action: ({ std, model }) => {
        (async () => {
          const file = await openSingleFileWith();
          if (!file) return;

          await addSiblingAttachmentBlocks(std, [file], model);
          if (model.text?.length === 0) {
            std.store.deleteBlock(model);
          }
        })().catch(console.error);
      },
    },
  ],
};
