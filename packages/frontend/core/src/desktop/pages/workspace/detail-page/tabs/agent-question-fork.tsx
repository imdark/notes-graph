import { Button } from '@notesgraph/component';
import {
  forkMessages,
  forkTranscript,
  RemoteAgentRunnerService,
  type RemoteQuestion,
  splitSuggestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import { AgentSideChat } from './agent-side-chat';
import * as styles from './agents.css';

/**
 * A chat beside a question a run is waiting on, to talk it through before
 * answering (see question-fork.ts). The run is not touched: it keeps waiting
 * until the reader sends an answer from the card.
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

  const opening = useCallback(async () => {
    // Without the transcript the fork can still talk about the question.
    const log = await remoteRunner
      .get(workspaceService.workspace.id, jobId)
      .then(job => job.log ?? '')
      .catch(() => '');
    return forkMessages(question, forkTranscript(log));
  }, [jobId, question, remoteRunner, workspaceService]);

  const renderReply = useCallback(
    (content: string) => {
      const { text: reply, suggestion } = splitSuggestion(content);
      return (
        <>
          <p className={styles.output}>{reply || '…'}</p>
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
      hint="A separate chat with what the agent has done so far. The agent doesn't see it and keeps waiting for your answer."
      placeholder="Ask anything about this before you answer"
      opening={opening}
      renderReply={renderReply}
      onClose={onClose}
      testId="agent-question-fork"
    />
  );
};
