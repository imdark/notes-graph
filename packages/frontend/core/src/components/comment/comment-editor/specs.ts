import { CodeBlockViewExtension } from '@blocksuite/notesgraph/blocks/code/view';
import { DividerViewExtension } from '@blocksuite/notesgraph/blocks/divider/view';
import { LatexViewExtension as LatexBlockViewExtension } from '@blocksuite/notesgraph/blocks/latex/view';
import { ListViewExtension } from '@blocksuite/notesgraph/blocks/list/view';
import { NoteViewExtension } from '@blocksuite/notesgraph/blocks/note/view';
import { ParagraphViewExtension } from '@blocksuite/notesgraph/blocks/paragraph/view';
import { RootViewExtension } from '@blocksuite/notesgraph/blocks/root/view';
import {
  PeekViewExtension,
  type PeekViewService,
} from '@blocksuite/notesgraph/components/peek';
import {
  type ViewExtensionContext,
  ViewExtensionManager,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { PlainTextClipboardConfig } from '@blocksuite/notesgraph/foundation/clipboard';
import { LatexInlineSpecExtension } from '@blocksuite/notesgraph/inlines/latex';
import { LatexViewExtension as LatexInlineViewExtension } from '@blocksuite/notesgraph/inlines/latex/view';
import { LinkInlineSpecExtension } from '@blocksuite/notesgraph/inlines/link';
import { LinkViewExtension } from '@blocksuite/notesgraph/inlines/link/view';
import { MentionInlineSpecExtension } from '@blocksuite/notesgraph/inlines/mention';
import { MentionViewExtension } from '@blocksuite/notesgraph/inlines/mention/view';
import {
  BackgroundInlineSpecExtension,
  BoldInlineSpecExtension,
  CodeInlineSpecExtension,
  ColorInlineSpecExtension,
  InlineSpecExtensions,
  ItalicInlineSpecExtension,
  StrikeInlineSpecExtension,
  UnderlineInlineSpecExtension,
} from '@blocksuite/notesgraph/inlines/preset';
import { ReferenceInlineSpecExtension } from '@blocksuite/notesgraph/inlines/reference';
import { ReferenceViewExtension } from '@blocksuite/notesgraph/inlines/reference/view';
import {
  DefaultOpenDocExtension,
  DocDisplayMetaService,
  DocModeService,
  FileSizeLimitService,
  FontConfigExtension,
  fontConfigSchema,
  FontLoaderService,
  PageViewportServiceExtension,
  ThemeService,
  ToolbarRegistryExtension,
} from '@blocksuite/notesgraph/shared/services';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph/shared/types';
import { InlineManagerExtension } from '@blocksuite/notesgraph/std/inline';
import { LinkedDocViewExtension } from '@blocksuite/notesgraph/widgets/linked-doc/view';
import { ToolbarViewExtension } from '@blocksuite/notesgraph/widgets/toolbar/view';
import { ViewportOverlayViewExtension } from '@blocksuite/notesgraph/widgets/viewport-overlay/view';
import { CloudViewExtension } from '@notesgraph/core/blocksuite/view-extensions/cloud';
import { NotesGraphEditorViewExtension } from '@notesgraph/core/blocksuite/view-extensions/editor-view/editor-view';
import { NotesGraphThemeViewExtension } from '@notesgraph/core/blocksuite/view-extensions/theme';
import { I18n } from '@notesgraph/i18n';
import type { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { createCommentLinkedWidgetConfig } from './linked-widget-config';

const commentEditorViewExtensionOptionsSchema = z.object({
  peekView: z.optional(z.custom<PeekViewService>()),
  fontConfig: z.optional(z.array(fontConfigSchema)),
});

export type CommentEditorViewExtensionOptions = z.infer<
  typeof commentEditorViewExtensionOptionsSchema
>;

class CommentEditorViewExtensionProvider extends ViewExtensionProvider<CommentEditorViewExtensionOptions> {
  override name = 'comment-editor';

  override schema = commentEditorViewExtensionOptionsSchema;

  override setup(
    context: ViewExtensionContext,
    options?: CommentEditorViewExtensionOptions
  ) {
    super.setup(context, options);
    context.register([
      ThemeService,
      DocModeService,
      DocDisplayMetaService,
      DefaultOpenDocExtension,
      FontLoaderService,
      ToolbarRegistryExtension,
      PageViewportServiceExtension,
      FileSizeLimitService,

      ...InlineSpecExtensions,
      InlineManagerExtension<NotesGraphTextAttributes>({
        id: 'DefaultInlineManager',
        specs: [
          BoldInlineSpecExtension.identifier,
          ItalicInlineSpecExtension.identifier,
          UnderlineInlineSpecExtension.identifier,
          StrikeInlineSpecExtension.identifier,
          CodeInlineSpecExtension.identifier,
          BackgroundInlineSpecExtension.identifier,
          ColorInlineSpecExtension.identifier,
          LatexInlineSpecExtension.identifier,
          ReferenceInlineSpecExtension.identifier,
          LinkInlineSpecExtension.identifier,
          MentionInlineSpecExtension.identifier,
        ],
      }),

      PlainTextClipboardConfig,
    ]);

    if (options?.fontConfig) {
      context.register(FontConfigExtension(options.fontConfig));
    }
    if (options?.peekView) {
      context.register(PeekViewExtension(options.peekView));
    }
  }
}

let manager: ViewExtensionManager | null = null;
export function getCommentEditorViewManager(framework: FrameworkProvider) {
  if (!manager) {
    manager = new ViewExtensionManager([
      CommentEditorViewExtensionProvider,

      // Blocks
      CodeBlockViewExtension,
      DividerViewExtension,
      LatexBlockViewExtension,
      ListViewExtension,

      NoteViewExtension,
      ParagraphViewExtension,
      RootViewExtension,

      // Inline
      LinkViewExtension,
      ReferenceViewExtension,
      MentionViewExtension,
      LatexInlineViewExtension,

      // Widget
      ToolbarViewExtension,
      ViewportOverlayViewExtension,
      LinkedDocViewExtension,

      // NotesGraph side
      NotesGraphThemeViewExtension,
      NotesGraphEditorViewExtension,

      // for rendering mentions
      CloudViewExtension,
    ]);

    manager.configure(ParagraphViewExtension, {
      getPlaceholder: () => {
        return I18n.t('com.notesgraph.notification.comment-prompt');
      },
    });

    manager.configure(
      LinkedDocViewExtension,
      createCommentLinkedWidgetConfig(framework)
    );

    manager.configure(CloudViewExtension, {
      framework,
      enableCloud: true,
    });
  }
  return manager;
}
