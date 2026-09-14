import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { patchDatabaseBlockConfigService } from './database-block-config-service';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

export type NotesGraphDatabaseViewOptions = z.infer<typeof optionsSchema>;

export class NotesGraphDatabaseViewExtension extends ViewExtensionProvider<NotesGraphDatabaseViewOptions> {
  override name = 'notesgraph-database-view';

  override schema = optionsSchema;

  override setup(
    context: ViewExtensionContext,
    options?: NotesGraphDatabaseViewOptions
  ) {
    super.setup(context, options);

    context.register(patchDatabaseBlockConfigService(options?.framework));
  }
}
