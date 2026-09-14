import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { getPreviewThemeExtension } from '@notesgraph/core/blocksuite/view-extensions/theme/preview-theme';
import { getThemeExtension } from '@notesgraph/core/blocksuite/view-extensions/theme/theme';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type NotesGraphThemeViewOptions = z.infer<typeof optionsSchema>;

export class NotesGraphThemeViewExtension extends ViewExtensionProvider<NotesGraphThemeViewOptions> {
  override name = 'notesgraph-view-theme';

  override schema = optionsSchema;

  override setup(
    context: ViewExtensionContext,
    options?: NotesGraphThemeViewOptions
  ) {
    super.setup(context, options);
    const framework = options?.framework;
    if (!framework) {
      return;
    }

    if (this.isPreview(context.scope)) {
      context.register(getPreviewThemeExtension(framework));
    } else {
      context.register(getThemeExtension(framework));
    }
  }
}
