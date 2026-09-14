import { setupGlobal } from '@notesgraph/env/global';
import { getBuildConfig } from '@notesgraph-tools/utils/build-config';
import { Package } from '@notesgraph-tools/utils/workspace';

globalThis.BUILD_CONFIG = getBuildConfig(new Package('@notesgraph/web'), {
  mode: 'development',
  channel: 'canary',
});

if (typeof window !== 'undefined') {
  window.location.search = '?prefixUrl=http://127.0.0.1:3010/';
}

setupGlobal();
