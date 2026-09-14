import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { patchLinkPreviewService } from './link-preview-service';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type NotesGraphLinkPreviewViewOptions = z.infer<typeof optionsSchema>;

export class NotesGraphLinkPreviewExtension extends ViewExtensionProvider<NotesGraphLinkPreviewViewOptions> {
  override name = 'notesgraph-link-preview-extension';

  override schema = optionsSchema;

  override setup(
    context: ViewExtensionContext,
    options?: NotesGraphLinkPreviewViewOptions
  ) {
    super.setup(context, options);
    if (!options?.framework) {
      return;
    }
    const { framework } = options;
    context.register(patchLinkPreviewService(framework));
  }
}
