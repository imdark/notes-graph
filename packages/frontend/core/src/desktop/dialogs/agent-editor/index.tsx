import { AgentEditor } from '@notesgraph/core/desktop/dialogs/setting/workspace-setting/agents/agent-editor';
import {
  type AgentDraft,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

/**
 * The agent editor on its own, outside settings, for places that need a new
 * agent on the spot — like assigning a task to one that doesn't exist yet.
 * Closes with the agent it created.
 */
export const AgentEditorDialog = ({
  close,
  scope = 'personal',
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['agent-editor']>) => {
  const agentsService = useService(AgentsService);

  const handleSubmit = useCallback(
    (draft: AgentDraft) => close(agentsService.create(scope, draft)),
    [agentsService, close, scope]
  );

  return (
    <AgentEditor
      scope={scope}
      open
      // The editor also reports closing after a save; by then the dialog has
      // already closed with the agent, so this one is a no-op.
      onOpenChange={open => !open && close()}
      onSubmit={handleSubmit}
    />
  );
};
