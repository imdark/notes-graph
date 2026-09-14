import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { createListToolbarConfigExtension } from './configs/toolbar.js';
import { effects } from './effects.js';
import { ListKeymapExtension, ListTextKeymapExtension } from './list-keymap.js';
import { ListMarkdownExtension } from './markdown.js';

export class ListViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-list-block';

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension('notesgraph:list'),
      BlockViewExtension('notesgraph:list', literal`notesgraph-list`),
      ListKeymapExtension,
      ListTextKeymapExtension,
      ListMarkdownExtension,
      ...createListToolbarConfigExtension('notesgraph:list'),
    ]);
  }
}
