import { Button } from '@notesgraph/component';
import {
  type ChatMessage,
  type ChatModel,
  CloudAgentRunnerService,
  forkMessages,
  forkTranscript,
  RemoteAgentRunnerService,
  type RemoteQuestion,
  splitSuggestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import * as styles from './agents.css';

/**
 * A chat beside a question a run is waiting on, to talk it through before
 * answering (see question-fork.ts). The run is not touched: it keeps waiting
 * until the reader sends an answer from the card.
 *
 * The model conversation is opened lazily, on the first message, so opening
 * the panel and closing it again costs nothing on the server.
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
  const cloudRunner = useService(CloudAgentRunnerService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);

  // Shown turns only; the opening context lives in `history` alone.
  const [turns, setTurns] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const model = useRef<ChatModel | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [turns]);

  /** The model, and the run's context as the conversation's opening. */
  const start = useCallback(async (): Promise<ChatModel> => {
    if (model.current) return model.current;
    const workspaceId = workspaceService.workspace.id;
    // Without the transcript the fork can still talk about the question.
    const log = await remoteRunner
      .get(workspaceId, jobId)
      .then(job => job.log ?? '')
      .catch(() => '');
    history.current = forkMessages(question, forkTranscript(log));
    model.current = await cloudRunner.open(workspaceId);
    return model.current;
  }, [cloudRunner, jobId, question, remoteRunner, workspaceService]);

  const ask = useCallback(
    async (message: string) => {
      setBusy(true);
      setError(null);
      setText('');
      setTurns(prev => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: '' },
      ]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const chat = await start();
        history.current = [
          ...history.current,
          { role: 'user', content: message },
        ];
        let reply = '';
        for await (const delta of chat(history.current, controller.signal)) {
          reply += delta;
          setTurns(prev => [
            ...prev.slice(0, -1),
            { role: 'assistant', content: reply },
          ]);
        }
        history.current = [
          ...history.current,
          { role: 'assistant', content: reply },
        ];
      } catch (err) {
        if (controller.signal.aborted) return;
        // Drop the empty reply; keep the question so it can be re-asked.
        setTurns(prev =>
          prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [start]
  );

  const canSend = text.trim().length > 0 && !busy;
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && canSend) {
        e.preventDefault();
        ask(text.trim()).catch(() => {});
      }
    },
    [ask, canSend, text]
  );

  return (
    <div className={styles.forkPanel} data-testid="agent-question-fork">
      <div className={styles.forkHead}>
        <span className={styles.questionLabel}>Talk it through</span>
        <button
          className={styles.linkButton}
          onClick={onClose}
          data-testid="agent-question-fork-close"
        >
          Close
        </button>
      </div>
      <span className={styles.hint}>
        A separate chat with what the agent has done so far. The agent doesn't
        see it and keeps waiting for your answer.
      </span>

      {turns.length > 0 ? (
        <div className={styles.forkMessages}>
          {turns.map((turn, i) => {
            if (turn.role === 'user') {
              return (
                <p key={i} className={styles.forkUser}>
                  {turn.content}
                </p>
              );
            }
            const { text: reply, suggestion } = splitSuggestion(turn.content);
            return (
              <div key={i} className={styles.forkReply}>
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
              </div>
            );
          })}
          <div ref={listEnd} />
        </div>
      ) : null}

      <textarea
        className={styles.questionInput}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask anything about this before you answer"
        rows={2}
        disabled={busy}
        autoFocus
        data-testid="agent-question-fork-input"
      />
      <div className={styles.sessionActions}>
        <Button
          disabled={!canSend}
          onClick={() => {
            ask(text.trim()).catch(() => {});
          }}
          data-testid="agent-question-fork-send"
        >
          {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
};
