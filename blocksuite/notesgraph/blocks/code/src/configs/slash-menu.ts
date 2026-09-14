import { type SlashMenuConfig } from '@blocksuite/notesgraph-widget-slash-menu';

export const codeSlashMenuConfig: SlashMenuConfig = {
  disableWhen: ({ model }) => {
    return model.flavour === 'notesgraph:code';
  },
  items: [],
};
