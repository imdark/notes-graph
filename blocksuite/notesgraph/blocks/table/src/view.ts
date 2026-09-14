import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { TableModelFlavour } from '@blocksuite/notesgraph-model';
import { SlashMenuConfigExtension } from '@blocksuite/notesgraph-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { tableSlashMenuConfig } from './configs/slash-menu';
import { effects } from './effects';
import { TableKeymapExtension } from './table-keymap.js';

export class TableViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-table-block';

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension(TableModelFlavour),
      TableKeymapExtension,
      BlockViewExtension(TableModelFlavour, literal`notesgraph-table`),
      SlashMenuConfigExtension(TableModelFlavour, tableSlashMenuConfig),
    ]);
  }
}
