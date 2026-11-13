import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';

import { LegacyDeploymentsView } from './legacy';
import { ReleasesView } from './releases';

// The run log's Deploy tab used these before the release screen; kept here
// until the legacy view goes.
export {
  DeployInProgress,
  LegacyDeploymentsView,
  useDeployCiRuns,
} from './legacy';

/**
 * The Deployments page, desktop and phone: what prod runs, the next release,
 * open pull requests and past deploys (enable_release_screen), or the older
 * task-status view.
 */
export const DeploymentsView = () => {
  const releaseScreen = useLiveData(
    useService(FeatureFlagService).flags.enable_release_screen.$
  );
  return releaseScreen ? <ReleasesView /> : <LegacyDeploymentsView />;
};
