import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';

import {
  DashboardBlockSchemaExtension,
  WidgetBlockSchemaExtension,
} from '../../dashboard/model';

export class DashboardStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-dashboard-store-extension';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(DashboardBlockSchemaExtension);
    context.register(WidgetBlockSchemaExtension);
  }
}
