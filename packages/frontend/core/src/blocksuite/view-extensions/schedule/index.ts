import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { scheduleWidgetExtensions } from './schedule-block-widget';
import { ScheduleSlashMenuConfigExtension } from './slash-menu';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type ScheduleViewOptions = z.infer<typeof optionsSchema>;

export class ScheduleViewExtension extends ViewExtensionProvider<ScheduleViewOptions> {
  override name = 'notesgraph-schedule-view-extension';

  override schema = optionsSchema;

  override setup(context: ViewExtensionContext, options?: ScheduleViewOptions) {
    super.setup(context, options);
    const framework = options?.framework;
    if (!framework) return;
    if (context.scope === 'page' || context.scope === 'edgeless') {
      context.register([
        ScheduleSlashMenuConfigExtension(framework),
        ...scheduleWidgetExtensions(framework),
      ]);
    }
  }
}
