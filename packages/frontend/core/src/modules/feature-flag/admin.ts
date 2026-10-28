import type { Framework } from '@notesgraph/infra';

import { WorkspaceServerService } from '../cloud';
import { WorkspaceScope } from '../workspace';
import { FeatureFlagAdminService } from './services/admin-overrides';
import { FeatureFlagService } from './services/feature-flag';

export {
  type AdminFlagSetting,
  FeatureFlagAdminService,
  withOverride,
} from './services/admin-overrides';

/**
 * Kept apart from configureFeatureFlagModule: the workspace module imports
 * that one, so it can't import the workspace module back.
 */
export function configureFeatureFlagAdminModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(FeatureFlagAdminService, [
      WorkspaceServerService,
      FeatureFlagService,
    ]);
}
