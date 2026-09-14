import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { SlashMenuConfigExtension } from '@blocksuite/notesgraph-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { CalloutKeymapExtension } from './callout-keymap';
import { calloutSlashMenuConfig } from './configs/slash-menu';
import { createBuiltinToolbarConfigExtension } from './configs/toolbar';
import { effects } from './effects';

export class CalloutViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-callout-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension('notesgraph:callout'),
      BlockViewExtension('notesgraph:callout', literal`notesgraph-callout`),
      CalloutKeymapExtension,
      SlashMenuConfigExtension('notesgraph:callout', calloutSlashMenuConfig),
      ...createBuiltinToolbarConfigExtension('notesgraph:callout'),
    ]);
  }
}
