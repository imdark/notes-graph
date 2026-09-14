import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { SlashMenuConfigExtension } from '@blocksuite/notesgraph-widget-slash-menu';
import {
  BlockViewExtension,
  FlavourExtension,
  WidgetViewExtension,
} from '@blocksuite/std';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { getCodeClipboardExtensions } from './clipboard/index.js';
import { CodeBlockConfigExtension } from './code-block-config';
import {
  CodeBlockInlineManagerExtension,
  CodeBlockUnitSpecExtension,
} from './code-block-inline.js';
import { CodeBlockHighlighter } from './code-block-service.js';
import { CodeKeymapExtension } from './code-keymap.js';
import { NOTESGRAPH_CODE_TOOLBAR_WIDGET } from './code-toolbar/index.js';
import { codeSlashMenuConfig } from './configs/slash-menu.js';
import { effects } from './effects.js';
import { CodeBlockMarkdownExtension } from './markdown.js';

const codeToolbarWidget = WidgetViewExtension(
  'notesgraph:code',
  NOTESGRAPH_CODE_TOOLBAR_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_CODE_TOOLBAR_WIDGET)}`
);

export class CodeBlockViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-code-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register([
      FlavourExtension('notesgraph:code'),
      CodeBlockHighlighter,
      BlockViewExtension('notesgraph:code', literal`notesgraph-code`),
      SlashMenuConfigExtension('notesgraph:code', codeSlashMenuConfig),
      CodeKeymapExtension,
      CodeBlockMarkdownExtension,
      ...getCodeClipboardExtensions(),
    ]);
    context.register([
      CodeBlockInlineManagerExtension,
      CodeBlockUnitSpecExtension,
    ]);
    if (!this.isMobile(context.scope)) {
      context.register(codeToolbarWidget);
    } else {
      context.register(
        CodeBlockConfigExtension({
          showLineNumbers: false,
        })
      );
    }
  }
}
