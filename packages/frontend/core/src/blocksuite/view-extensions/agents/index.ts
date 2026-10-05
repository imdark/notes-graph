import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { agentAssignWidgetExtensions } from './assign-widget';
import { agentRunsWidgetExtensions } from './block-runs-widget';
import { AgentsSlashMenuConfigExtension } from './slash-menu';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type AgentsViewOptions = z.infer<typeof optionsSchema>;

/**
 * Puts the workspace's agents in the editor's slash menu, a chip on each
 * block agents worked on that opens those runs, and an assign-to-agent
 * button on to-do lines no agent is on.
 *
 * Deliberately separate from AIViewExtension: that one is gated on the server
 * advertising Copilot and drags in the ~9MB blocksuite/ai bundle, neither of
 * which agents need — they run on whatever backend the workspace has.
 */
export class AgentsViewExtension extends ViewExtensionProvider<AgentsViewOptions> {
  override name = 'notesgraph-agents-view-extension';

  override schema = optionsSchema;

  override setup(context: ViewExtensionContext, options?: AgentsViewOptions) {
    super.setup(context, options);
    const framework = options?.framework;
    if (!framework) return;
    context.register(AgentsSlashMenuConfigExtension(framework));
    if (context.scope === 'page' || context.scope === 'edgeless') {
      context.register(agentRunsWidgetExtensions(framework));
      context.register(agentAssignWidgetExtensions(framework));
    }
  }
}
