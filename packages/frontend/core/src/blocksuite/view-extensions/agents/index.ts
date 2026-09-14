import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { FrameworkProvider } from '@notesgraph/infra';
import { z } from 'zod';

import { AgentsSlashMenuConfigExtension } from './slash-menu';

const optionsSchema = z.object({
  framework: z.instanceof(FrameworkProvider).optional(),
});

type AgentsViewOptions = z.infer<typeof optionsSchema>;

/**
 * Puts the workspace's agents in the editor's slash menu.
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
  }
}
