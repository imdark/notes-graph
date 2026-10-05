import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import {
  BlockViewExtension,
  FlavourExtension,
} from '@blocksuite/notesgraph/std';
import { FrameworkProvider } from '@notesgraph/infra';
import { literal, unsafeStatic } from 'lit/static-html.js';
import { z } from 'zod';

import { DASHBOARD_BLOCK_TAG } from '../../dashboard/dashboard-block';
import { dashboardFrameworkExtension } from '../../dashboard/framework';
import {
  DashboardBlockFlavour,
  WidgetBlockFlavour,
} from '../../dashboard/model';
import { DashboardSlashMenuConfigExtension } from '../../dashboard/slash-menu';
import { WIDGET_BLOCK_TAG } from '../../dashboard/widget-block';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type DashboardViewOptions = z.infer<typeof optionsSchema>;

/**
 * Dashboards and chart widgets. The blocks render in every scope (a preview
 * or an export shows the layout too); the charts need the framework for
 * monitors, and the slash menu only matters where people type.
 */
export class DashboardViewExtension extends ViewExtensionProvider<DashboardViewOptions> {
  override name = 'notesgraph-dashboard-view-extension';

  override schema = optionsSchema;

  override setup(
    context: ViewExtensionContext,
    options?: DashboardViewOptions
  ) {
    super.setup(context, options);
    context.register([
      FlavourExtension(DashboardBlockFlavour),
      BlockViewExtension(
        DashboardBlockFlavour,
        literal`${unsafeStatic(DASHBOARD_BLOCK_TAG)}`
      ),
      FlavourExtension(WidgetBlockFlavour),
      BlockViewExtension(
        WidgetBlockFlavour,
        literal`${unsafeStatic(WIDGET_BLOCK_TAG)}`
      ),
      DashboardSlashMenuConfigExtension,
    ]);
    const framework = options?.framework;
    if (framework) context.register(dashboardFrameworkExtension(framework));
  }
}
