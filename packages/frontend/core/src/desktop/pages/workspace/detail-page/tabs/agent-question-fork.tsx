import { Button } from '@notesgraph/component';
import {
  AgentExecutorService,
  forkMessages,
  forkTranscript,
  type RemoteJob,
  RemoteAgentRunnerService,
  type RemoteQuestion,
  splitSuggestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback, useRef } from 'react';

import { AgentSideChat, ChatReplyText } from './agent-side-chat';

/**
 * A chat beside a question a run is waiting on, to talk it through before
 * answering (see question-fork.ts). The run is not touched: it keeps waiting
 * until the reader sends an answer from the card.
 *
 * It is a fork of the run: asked on the device the run is on, as the agent it
 * runs as, starting from its transcript — not on the server's model, which a
 * server may not have.
 */
export const AgentQuestionFork = ({
  jobId,
  question,
  onUseAnswer,
  onClose,
}: {
  jobId: string;
  question: RemoteQuestion;
  /** Put a suggested answer in the card's answer box, unsent. */
  onUseAnswer?: (answer: string) => void;
  onClose: () => void;
}) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const executor = useService(AgentExecutorService);

  // The opening and the model both come from the job; read it once.
  const jobRead = useRef<Promise<RemoteJob> | null>(null);
  const readJob = useCallback(() => {
    jobRead.current ??= remoteRunner.get(workspaceService.workspace.id, jobId);
    return jobRead.current;
  }, [jobId, remoteRunner, workspaceService]);

  const opening = useCallback(async () => {
    // Without the transcript the fork can still talk about the question.
    const log = await readJob()
      .then(job => job.log ?? '')
      .catch(() => '');
    return forkMessages(question, forkTranscript(log));
  }, [question, readJob]);

  const openModel = useCallback(
    async () => executor.forkOf(await readJob()),
    [executor, readJob]
  );

  const renderReply = useCallback(
    (content: string, streaming: boolean) => {
      const { text: reply, suggestion } = splitSuggestion(content);
      return (
        <>
          <ChatReplyText text={reply} streaming={streaming} />
          {suggestion && onUseAnswer ? (
            <Button
              onClick={() => onUseAnswer(suggestion)}
              tooltip="Put this in the answer box. Nothing is sent until you send it."
              data-testid="agent-question-fork-use"
            >
              Use “{suggestion}”
            </Button>
          ) : null}
        </>
      );
    },
    [onUseAnswer]
  );

  return (
    <AgentSideChat
      title="Talk it through"
      hint="A fork of the run on its device, with what the agent has done so far. The agent doesn't see it and keeps waiting for your answer."
      placeholder="Ask anything about this before you answer"
      opening={opening}
      openModel={openModel}
      renderReply={renderReply}
      onClose={onClose}
      testId="agent-question-fork"
    />
  );
};
