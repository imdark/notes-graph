import { type Container, createIdentifier } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';

/**
 * Bridges the core framework into the editor, so the agents widgets (the
 * runs chip and the assign button) can reach services.
 *
 * Bound once, by AgentsViewExtension: an editor's DI refuses a second binding
 * of the same identifier, and the editor then fails to start at all.
 */
export const AgentsFrameworkIdentifier = createIdentifier<FrameworkProvider>(
  'NotesGraphAgentsFramework'
);

export const agentsFrameworkExtension = (
  framework: FrameworkProvider
): ExtensionType => ({
  setup: (di: Container) => {
    di.addImpl(AgentsFrameworkIdentifier, () => framework);
  },
});
