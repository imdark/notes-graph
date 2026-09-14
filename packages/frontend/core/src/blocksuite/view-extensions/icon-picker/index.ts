import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { patchIconPickerService } from './icon-picker-service';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type NotesGraphIconPickerViewOptions = z.infer<typeof optionsSchema>;

export class NotesGraphIconPickerExtension extends ViewExtensionProvider<NotesGraphIconPickerViewOptions> {
  override name = 'notesgraph-icon-picker-extension';

  override schema = optionsSchema;

  override setup(
    context: ViewExtensionContext,
    options?: NotesGraphIconPickerViewOptions
  ) {
    super.setup(context, options);
    if (!options?.framework) {
      return;
    }
    const { framework } = options;
    context.register(patchIconPickerService(framework));
  }
}
