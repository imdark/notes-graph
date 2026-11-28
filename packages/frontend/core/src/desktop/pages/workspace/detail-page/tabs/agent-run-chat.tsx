import {
  AgentContextService,
  AgentExecutorService,
  type AgentRun,
  AgentRunLogsStore,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
  askTranscript,
  canResume,
  continuationBrief,
  FOLLOW_UP_TRANSCRIPT_CHARS,
  forkTranscript,
  RemoteAgentRunnerService,
  resumeBrief,
  type RunChatContext,
  runChatMessages,
  standInAgent,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback, useMemo, useRef } from 'react';

import {
  AgentSideChat,
  type SideChatFollowUp,
  type SideChatRecord,
} from './agent-side-chat';

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
  fill,
}: {
  run: AgentRun;
  /** The run's full answer when the caller has it; the row keeps a summary. */
  output?: string;
  /** The chat to go on with; the run's newest one when not given. */
  resumeAskId?: string;
  onClose?: () => void;
  /** Fill the dialog instead of sitting in a box; see AgentSideChat. */
  fill?: boolean;
}) => {
  const logsStore = useService(AgentRunLogsStore);
  const runsStore = useService(AgentRunsStore);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const executor = useService(AgentExecutorService);
  const agentsService = useService(AgentsService);
  const contextService = useService(AgentContextService);
  const sessionService = useService(AgentRunSessionService);

  // The agent that ran it. A device run with no agent row (a subtask from
  // start_agent_run, or an agent deleted since) gets one rebuilt from its job,
  // on the device and model it ran on.
  const runAgent = useCallback(async () => {
    const saved = agentsService.agents$.value.find(a => a.id === run.agentId);
    if (saved) return saved;
    const job = run.remoteJobId
      ? await remoteRunner
          .get(workspaceService.workspace.id, run.remoteJobId)
          .catch(() => null)
      : null;
    return standInAgent(run, job);
  }, [agentsService, remoteRunner, run, workspaceService]);

  // Asked of the agent that ran it, on the same runtime — a run on a device's
  // Claude Code is asked there, not on the server's model.
  const openModel = useCallback(async () => {
    const agent = await runAgent();
    if (!agent) {
      throw new Error(
        `The agent that ran this (${run.agentName}) no longer exists, so there is no one to ask.`
      );
    }
    return executor.chatFor(agent);
  }, [executor, runAgent, run.agentName]);

  // Without the transcript the chat can still go on the input and answer.
  // A follow-up run is given more of the transcript than the chat is.
  const runRecord = useCallback(
    async (limit?: number): Promise<RunChatContext> => {
      if (run.remoteJobId) {
        const job = await remoteRunner
          .get(workspaceService.workspace.id, run.remoteJobId)
          .catch(() => null);
        return {
          transcript: forkTranscript(job?.log ?? '', limit),
          output: output ?? job?.result ?? undefined,
        };
      }
      const log = await logsStore.get(run.id).catch(() => undefined);
      return { transcript: forkTranscript(log ?? '', limit), output };
    },
    [logsStore, output, remoteRunner, run, workspaceService]
  );

  const opening = useCallback(
    async () => runChatMessages(run, await runRecord()),
    [run, runRecord]
  );

  // An ended run's session is gone, so it is carried on by a new one rebuilt
  // from its transcript: the agent, the task, what it did and what the reader
  // asks. Most often the run died (failed or was stopped), but a finished one
  // can be taken further the same way.
  const followUp = useMemo<SideChatFollowUp | undefined>(
    () =>
      run.status !== 'running'
        ? {
            label: 'Continue the run',
            title:
              'Start a new run of the agent on this task, given this run’s transcript, this chat and what you typed',
            start: async (message, chat) => {
              const agent = await runAgent();
              if (!agent) {
                throw new Error(
                  `${run.agentName} has been deleted, so there is no agent to continue it.`
                );
              }
              const target = runsStore.targetOf(run);
              if (!target) {
                throw new Error(
                  "Which blocks the run was on wasn't recorded, so it can't be continued. Select them and run the agent with Ctrl/⌘ K."
                );
              }
              // A run on a device whose runner keeps sessions goes on in its
              // own session, on that device, where its worktree is.
              if (canResume(run)) {
                const task = await contextService
                  .build(target)
                  .catch(() => null);
                sessionService
                  .start(
                    { ...agent, deviceKey: run.deviceKey },
                    target,
                    resumeBrief(task, run, message, chat)
                  )
                  .catch(console.error);
                return `Continued in ${run.agentName}'s own session on ${run.deviceKey}, with what you typed: it has the run's work and history. It is in the run list and in the note's Agents panel.`;
              }
              const [task, record] = await Promise.all([
                // Without it, the earlier run's input stands in.
                contextService.build(target).catch(() => null),
                runRecord(FOLLOW_UP_TRANSCRIPT_CHARS),
              ]);
              sessionService
                .start(
                  agent,
                  target,
                  continuationBrief(task, run, record, message, chat)
                )
                .catch(console.error);
              return `Continued in a new run of ${run.agentName}, given this run's transcript and this chat. It is in the run list and in the note's Agents panel.`;
            },
          }
        : undefined,
    [contextService, run, runAgent, runRecord, runsStore, sessionService]
  );

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
        const steps = chat.turns.filter(
          t => t.role === 'assistant' && !t.error
        ).length;
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
      hint={
        followUp
          ? "A chat with what the run was given, what it did and how it ended. Asking only explains. To carry on the work, type what to do and press Continue the run: a new run picks up from this one's transcript."
          : "A chat with what the run was given, what it did and how it ended. It can explain, not act: the agent doesn't see it and nothing changes in the note."
      }
      placeholder={
        run.status === 'error'
          ? 'Why did it fail? Or what should a new run do?'
          : run.status === 'cancelled'
            ? 'What did it get done? Or what should a new run do?'
            : 'What did it change? What is left to do?'
      }
      opening={opening}
      openModel={openModel}
      record={record}
      followUp={followUp}
      onClose={onClose}
      fill={fill}
      testId="agent-run-chat"
    />
  );
};
