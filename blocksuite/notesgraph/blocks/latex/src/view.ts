import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { SlashMenuConfigExtension } from '@blocksuite/notesgraph-widget-slash-menu';
import { BlockViewExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { latexSlashMenuConfig } from './configs/slash-menu';
import { effects } from './effects';

export class LatexViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-latex-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      BlockViewExtension('notesgraph:latex', literal`notesgraph-latex`),
      SlashMenuConfigExtension('notesgraph:latex', latexSlashMenuConfig),
    ]);
  }
}
