import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { getFeatureFlagSyncer } from '@notesgraph/core/blocksuite/store-extensions/feature-flag/feature-flag-syncer';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { z } from 'zod';

const optionsSchema = z.object({
  featureFlagService: z.instanceof(FeatureFlagService).optional(),
});

export class FeatureFlagStoreExtension extends StoreExtensionProvider {
  override name = 'feature-flag-store-extension';

  override schema = optionsSchema;

  override setup(
    context: StoreExtensionContext,
    options?: z.infer<typeof optionsSchema>
  ) {
    super.setup(context, options);
    const featureFlagService = options?.featureFlagService;
    if (!featureFlagService) {
      return;
    }
    context.register(getFeatureFlagSyncer(featureFlagService));
  }
}
