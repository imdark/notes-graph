import {
  AgentExecutorService,
  type AgentRun,
  AgentRunLogsStore,
  AgentRunsStore,
  AgentsService,
  askTranscript,
  forkTranscript,
  RemoteAgentRunnerService,
  runChatMessages,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback, useMemo, useRef } from 'react';

import { AgentSideChat, type SideChatRecord } from './agent-side-chat';

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
  resumeAskId,
  onClose,
}: {
  run: AgentRun;
  /** The run's full answer when the caller has it; the row keeps a summary. */
  output?: string;
  /** The chat to go on with; the run's newest one when not given. */
  resumeAskId?: string;
  onClose?: () => void;
}) => {
  const logsStore = useService(AgentRunLogsStore);
  const runsStore = useService(AgentRunsStore);
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

  // The chat is a row of its own beside the runs, made as it is first asked,
  // so its turns and errors can be found in the run list and gone on with.
  const askId = useRef<string | null>(
    resumeAskId ?? runsStore.latestAsk(run.id)?.id ?? null
  );
  const record = useMemo<SideChatRecord>(
    () => ({
      load: async () =>
        askId.current
          ? ((await logsStore.getChat(askId.current)) ?? null)
          : null,
      asking: () => {
        if (askId.current && runsStore.resumeAsk(askId.current)) return;
        askId.current = runsStore.startAsk(run);
      },
      ended: (chat, turn, outcome) => {
        const id = askId.current;
        if (!id) return;
        const steps = chat.turns.filter(t => t.role === 'assistant').length;
        const last = chat.turns.at(-1);
        const error =
          outcome.status === 'error'
            ? outcome.error
            : outcome.status === 'cancelled'
              ? 'Closed before the answer came.'
              : undefined;
        // The log only grows, so an error stays in it after a later answer.
        // It is written before the row ends, which is when the Log tab reads.
        (async () => {
          const log = (await logsStore.get(id)) ?? '';
          await logsStore.put(id, log + askTranscript(turn, error));
          await logsStore.putChat(id, chat);
        })()
          .catch(() => {
            // The row still says how it ended; only the turns are lost.
          })
          .finally(() =>
            runsStore.finish(
              id,
              outcome.status === 'done'
                ? {
                    status: 'done',
                    steps,
                    output: last?.role === 'assistant' ? last.content : '',
                  }
                : outcome.status === 'error'
                  ? { status: 'error', steps, error: outcome.error }
                  : { status: 'cancelled', steps }
            )
          );
      },
    }),
    [logsStore, run, runsStore]
  );

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
      record={record}
      onClose={onClose}
      testId="agent-run-chat"
    />
  );
};
