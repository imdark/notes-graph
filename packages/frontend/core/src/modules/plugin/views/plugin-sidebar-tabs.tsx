import { PluginIcon } from '@blocksuite/icons/rc';
import { ViewSidebarTab } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';

import { PluginContributionRegistry } from '../services/contribution-registry';

/**
 * Renders every plugin-contributed sidebar panel as a tab in the editor's right
 * sidebar (via the workbench island system). Must be rendered inside a View.
 */
export function PluginSidebarTabs() {
  const registry = useService(PluginContributionRegistry);
  const panels = useLiveData(registry.panels$);

  return (
    <>
      {panels.map(({ pluginId, spec }) => {
        const Panel = spec.component;
        return (
          <ViewSidebarTab
            key={`${pluginId}:${spec.id}`}
            tabId={`plugin:${pluginId}:${spec.id}`}
            icon={spec.icon ?? <PluginIcon />}
          >
            <Panel />
          </ViewSidebarTab>
        );
      })}
    </>
  );
}
