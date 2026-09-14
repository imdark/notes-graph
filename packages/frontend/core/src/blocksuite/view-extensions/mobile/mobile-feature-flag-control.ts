import { FeatureFlagService } from '@blocksuite/notesgraph/shared/services';
import {
  type BlockStdScope,
  LifeCycleWatcher,
} from '@blocksuite/notesgraph/std';

export class MobileFeatureFlagControl extends LifeCycleWatcher {
  static override key = 'mobile-patches';

  constructor(std: BlockStdScope) {
    super(std);
    const featureFlagService = std.get(FeatureFlagService);

    featureFlagService.setFlag('enable_mobile_keyboard_toolbar', true);
    featureFlagService.setFlag('enable_mobile_linked_doc_menu', true);
  }
}
