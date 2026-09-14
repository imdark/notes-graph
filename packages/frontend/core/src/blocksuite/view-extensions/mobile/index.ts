import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { KeyboardToolbarExtension } from '@notesgraph/core/blocksuite/view-extensions/mobile/keyboard-toolbar-extension';
import { MobileFeatureFlagControl } from '@notesgraph/core/blocksuite/view-extensions/mobile/mobile-feature-flag-control';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type MobileViewOptions = z.infer<typeof optionsSchema>;

export class MobileViewExtension extends ViewExtensionProvider<MobileViewOptions> {
  override name = 'mobile-view-extension';

  override schema = optionsSchema;

  override setup(context: ViewExtensionContext, options?: MobileViewOptions) {
    super.setup(context, options);
    const isMobile = BUILD_CONFIG.isMobileEdition;
    if (!isMobile) return;

    const framework = options?.framework;
    if (framework) {
      context.register(KeyboardToolbarExtension(framework));
    }

    context.register(MobileFeatureFlagControl);
  }
}
