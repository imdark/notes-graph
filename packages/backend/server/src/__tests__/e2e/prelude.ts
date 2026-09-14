import { getBuildConfig } from '@notesgraph-tools/utils/build-config';
import { Package } from '@notesgraph-tools/utils/workspace';

import { createApp } from './create-app';

globalThis.BUILD_CONFIG = getBuildConfig(new Package('@notesgraph/web'), {
  mode: 'development',
  channel: 'canary',
});
// @ts-expect-error testing
globalThis.app = await createApp();
