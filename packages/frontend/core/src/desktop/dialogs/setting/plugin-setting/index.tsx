import { PluginIcon } from '@blocksuite/icons/rc';
import type { SettingTab } from '@notesgraph/core/modules/dialogs/constant';
import { PluginContributionRegistry } from '@notesgraph/core/modules/plugin';
import { useLiveData, useService } from '@notesgraph/infra';
import { useMemo } from 'react';

import type { SettingSidebarItem } from '../types';

/** `plugin:<pluginId>:<pageId>` — the tab key for a contributed page. */
const tabKey = (pluginId: string, pageId: string): SettingTab =>
  `plugin:${pluginId}:${pageId}`;

export const isPluginSetting = (key: string): boolean =>
  key.startsWith('plugin:');

/**
 * Settings pages contributed by plugins through `ui.addSettingsPage`.
 *
 * Until now this contribution point was registered but never rendered, so
 * `addSettingsPage` did nothing. The component comes from the plugin's own
 * bundle and renders inside the host's React only because the page's import
 * map hands plugins the host's instance (see modules/plugin/runtime.ts) —
 * without that, a hook in here throws on mount.
 */
export const usePluginSettingList = (): SettingSidebarItem[] => {
  const registry = useService(PluginContributionRegistry);
  const pages = useLiveData(registry.settingsPages$);

  return useMemo(
    () =>
      pages.map(({ pluginId, spec }) => ({
        key: tabKey(pluginId, spec.id),
        title: spec.title,
        icon: <PluginIcon />,
        testId: `plugin-setting:${pluginId}:${spec.id}`,
      })),
    [pages]
  );
};

export const PluginSetting = ({ activeTab }: { activeTab: SettingTab }) => {
  const registry = useService(PluginContributionRegistry);
  const pages = useLiveData(registry.settingsPages$);

  const match = pages.find(
    ({ pluginId, spec }) => tabKey(pluginId, spec.id) === activeTab
  );

  // A plugin can be disabled or uninstalled while its page is open, which
  // takes its contribution out of the registry from under us.
  if (!match) {
    return null;
  }

  const Component = match.spec.component;
  return <Component />;
};
