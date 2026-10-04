import { Button } from '@notesgraph/component';
import {
  RemoteAgentRunnerService,
  type RemoteQuestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react';

import * as styles from './agents.css';
import { parseEditPreview } from './edit-diff';
import { EditDiffView } from './edit-diff-view';

/**
 * One thing a running agent is waiting on the reader for: a question to
 * answer in words, or a tool to allow or deny.
 *
 * Once sent it shows as sent until the next poll drops it from the open
 * list; the run picks the answer up from the server, not from here.
 */
export const AgentQuestionCard = ({
  jobId,
  question,
}: {
  jobId: string;
  question: RemoteQuestion;
}) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (answer: { answer?: string; allowed?: boolean; allowAll?: boolean }) => {
      setState('sending');
      setError(null);
      remoteRunner
        .answer(workspaceService.workspace.id, jobId, question.id, answer)
        .then(() => setState('sent'))
        .catch(err => {
          setState('idle');
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [jobId, question.id, remoteRunner, workspaceService]
  );

  const isPermission = question.kind === 'permission';
  // File edits get a before/after diff instead of the raw tool input.
  const editPreview = useMemo(
    () =>
      isPermission ? parseEditPreview(question.text, question.detail) : null,
    [isPermission, question.text, question.detail]
  );
  const options = isPermission ? [] : (question.options ?? []);
  const canSendAnswer = text.trim().length > 0 && state === 'idle';

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends, as in a chat; Shift+Enter is a new line.
      if (e.key === 'Enter' && !e.shiftKey && !isPermission && canSendAnswer) {
        e.preventDefault();
        send({ answer: text.trim() });
      }
    },
    [canSendAnswer, isPermission, send, text]
  );

  return (
    <div className={styles.questionCard} data-testid="agent-question">
      <span className={styles.questionLabel}>
        {isPermission ? 'Wants permission' : 'Asks you'}
      </span>
      <p className={styles.questionText}>{question.text}</p>
      {editPreview ? (
        <EditDiffView preview={editPreview} />
      ) : question.detail ? (
        <pre className={styles.questionDetail}>{question.detail}</pre>
      ) : null}

      {state === 'sent' ? (
        <span className={styles.hint}>Sent — it will carry on from here.</span>
      ) : (
        <>
          {options.length > 0 ? (
            <div
              className={styles.questionOptions}
              data-testid="agent-question-options"
            >
              {options.map(option => (
                <Button
                  key={option}
                  disabled={state !== 'idle'}
                  onClick={() => send({ answer: option })}
                  data-testid="agent-question-option"
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
          <textarea
            className={styles.questionInput}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isPermission
                ? 'Add a note (optional)'
                : options.length > 0
                  ? 'Or type your own answer'
                  : 'Your answer'
            }
            rows={isPermission ? 1 : 2}
            disabled={state === 'sending'}
            data-testid="agent-question-input"
          />
          <div className={styles.sessionActions}>
            {isPermission ? (
              <>
                <Button
                  variant="primary"
                  disabled={state !== 'idle'}
                  onClick={() =>
                    send({ allowed: true, answer: text.trim() || undefined })
                  }
                  data-testid="agent-question-allow"
                >
                  Allow
                </Button>
                <Button
                  disabled={state !== 'idle'}
                  onClick={() =>
                    send({
                      allowed: true,
                      allowAll: true,
                      answer: text.trim() || undefined,
                    })
                  }
                  tooltip="Allow this and every other tool for the rest of this run, without asking again"
                  data-testid="agent-question-allow-all"
                >
                  Allow all
                </Button>
                <Button
                  disabled={state !== 'idle'}
                  onClick={() =>
                    send({ allowed: false, answer: text.trim() || undefined })
                  }
                  data-testid="agent-question-deny"
                >
                  Deny
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                disabled={!canSendAnswer}
                onClick={() => send({ answer: text.trim() })}
                data-testid="agent-question-send"
              >
                Send
              </Button>
            )}
          </div>
          {!isPermission ? (
            <span className={styles.hint}>
              The agent saves what you tell it to your notes, so it won't ask
              again.
            </span>
          ) : null}
        </>
      )}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
};
