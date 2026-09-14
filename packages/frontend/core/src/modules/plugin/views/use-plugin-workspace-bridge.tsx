import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

import { DocsService } from '../../doc';
import { PluginContextFactory } from '../services/context-factory';
import { PluginService } from '../services/plugin';

/**
 * Boots the plugin host at startup and bridges the active workspace's
 * `DocsService` into the (root-scoped) plugin context factory, so the plugin
 * `docs` capability acts on the current workspace. Render once inside a
 * workspace scope.
 */
export function usePluginWorkspaceBridge() {
  // Resolving PluginService instantiates the (lazy) service so its restore()
  // runs on load — otherwise installed plugins only activate when the
  // Settings → Plugins page is opened.
  useService(PluginService);
  const factory = useService(PluginContextFactory);
  const docsService = useService(DocsService);

  useEffect(() => {
    factory.setActiveDocs(docsService);
    return () => {
      factory.setActiveDocs(null);
    };
  }, [factory, docsService]);
}
