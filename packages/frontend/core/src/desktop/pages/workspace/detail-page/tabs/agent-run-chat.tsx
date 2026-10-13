import {
  AgentExecutorService,
  type AgentRun,
  AgentRunLogsStore,
  AgentsService,
  forkTranscript,
  RemoteAgentRunnerService,
  runChatMessages,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import { AgentSideChat } from './agent-side-chat';

/**
 * Ask about a run that has ended — what it did, why it failed, what is left —
 * in a chat seeded with its input, transcript and answer (see run-chat.ts).
 *
 * The record is read when the first question is sent, so it is the run's
 * whole transcript: a device job's from the server, an in-tab run's from
 * this browser, where the executor saved it as the run ended.
 */
export const AgentRunChat = ({
  run,
  output,
  onClose,
}: {
  run: AgentRun;
  /** The run's full answer when the caller has it; the row keeps a summary. */
  output?: string;
  onClose?: () => void;
}) => {
  const logsStore = useService(AgentRunLogsStore);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const executor = useService(AgentExecutorService);
  const agentsService = useService(AgentsService);

  // Asked of the agent that ran it, on the same runtime — a run on a device's
  // Claude Code is asked there, not on the server's model.
  const openModel = useCallback(async () => {
    const agent = agentsService.agents$.value.find(a => a.id === run.agentId);
    if (!agent) {
      throw new Error(
        `The agent that ran this (${run.agentName}) no longer exists, so there is no one to ask.`
      );
    }
    return executor.chatFor(agent);
  }, [agentsService, executor, run.agentId, run.agentName]);

  const opening = useCallback(async () => {
    // Without the transcript the chat can still go on the input and answer.
    if (run.remoteJobId) {
      const job = await remoteRunner
        .get(workspaceService.workspace.id, run.remoteJobId)
        .catch(() => null);
      return runChatMessages(run, {
        transcript: forkTranscript(job?.log ?? ''),
        output: output ?? job?.result ?? undefined,
      });
    }
    const log = await logsStore.get(run.id).catch(() => undefined);
    return runChatMessages(run, {
      transcript: forkTranscript(log ?? ''),
      output,
    });
  }, [logsStore, output, remoteRunner, run, workspaceService]);

  return (
    <AgentSideChat
      title="Ask about this run"
      hint="A chat with what the run was given, what it did and how it ended. It can explain, not act: the agent doesn't see it and nothing changes in the note."
      placeholder={
        run.status === 'error'
          ? 'Why did it fail? What did it get done first?'
          : 'What did it change? What is left to do?'
      }
      opening={opening}
      openModel={openModel}
      onClose={onClose}
      testId="agent-run-chat"
    />
  );
};
