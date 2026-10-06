import { type Container, createIdentifier } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';

/**
 * Bridges the core framework into the editor, so chart widgets can read
 * monitors. Its own identifier, not the agents one: each may be bound only
 * once per editor, and the two extensions are registered independently.
 */
export const DashboardFrameworkIdentifier = createIdentifier<FrameworkProvider>(
  'NotesGraphDashboardFramework'
);

export const dashboardFrameworkExtension = (
  framework: FrameworkProvider
): ExtensionType => ({
  setup: (di: Container) => {
    di.addImpl(DashboardFrameworkIdentifier, () => framework);
  },
});
