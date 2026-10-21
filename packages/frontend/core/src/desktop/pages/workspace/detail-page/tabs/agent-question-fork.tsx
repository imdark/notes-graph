import { Button } from '@notesgraph/component';
import {
  AgentExecutorService,
  forkMessages,
  forkTranscript,
  RemoteAgentRunnerService,
  type RemoteJob,
  type RemoteQuestion,
  splitSuggestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback, useRef, useState } from 'react';

import { AgentSideChat, ChatReplyText } from './agent-side-chat';

/**
 * A chat beside a question a run is waiting on, to talk it through before
 * answering (see question-fork.ts). The run is not touched: it keeps waiting
 * until the reader sends an answer from the card.
 *
 * It is a fork of the run: asked on the device the run is on, as the agent it
 * runs as, starting from its transcript — not on the server's model, which a
 * server may not have. A turn takes a job slot there, so with every slot held
 * by runs waiting on the reader it waits too, and says so.
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
  const [waiting, setWaiting] = useState<string | null>(null);

  // The opening and the model both come from the job; read it once. A read
  // that failed is tried again on the next send rather than kept.
  const jobRead = useRef<Promise<RemoteJob> | null>(null);
  const readJob = useCallback(() => {
    if (!jobRead.current) {
      const read = remoteRunner.get(workspaceService.workspace.id, jobId);
      jobRead.current = read;
      read.catch(() => {
        if (jobRead.current === read) jobRead.current = null;
      });
    }
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
    async () => executor.forkOf(await readJob(), setWaiting),
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
      waiting={waiting}
      renderReply={renderReply}
      onClose={onClose}
      testId="agent-question-fork"
    />
  );
};
