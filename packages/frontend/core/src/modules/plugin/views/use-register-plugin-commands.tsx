import { ImportIcon, PlusIcon } from '@blocksuite/icons/rc';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

import { registerNotesGraphCommand } from '../../../commands';
import { PluginContributionRegistry } from '../services/contribution-registry';

/**
 * Surfaces plugin-contributed commands in the command palette, plus a built-in
 * "Manage plugins" command that opens the Plugins settings page. Call once from
 * the workspace side-effects host.
 */
export function useRegisterPluginCommands() {
  const dialogService = useService(WorkspaceDialogService);
  const registry = useService(PluginContributionRegistry);
  const commands = useLiveData(registry.commands$);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      registerNotesGraphCommand({
        id: 'notesgraph:plugin-manage',
        label: 'Plugins: Manage plugins…',
        icon: <ImportIcon />,
        category: 'notesgraph:general',
        run: () => {
          dialogService.open('setting', { activeTab: 'plugins' });
        },
      })
    );

    for (const { pluginId, spec } of commands) {
      unsubs.push(
        registerNotesGraphCommand({
          id: `plugin:${pluginId}:${spec.id}`,
          label: spec.label,
          icon: spec.icon ?? <PlusIcon />,
          category: 'notesgraph:general',
          keyBinding: spec.keybinding,
          run: () => spec.run(),
        })
      );
    }

    return () => unsubs.forEach(unsub => unsub());
  }, [commands, dialogService]);
}
