import { Button } from '@notesgraph/component';
import {
  type ChatMessage,
  type ChatModel,
  CloudAgentRunnerService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import * as styles from './agents.css';

/**
 * A chat with the server's model about a run, seeded with the run's context:
 * the question fork beside a question a run is waiting on, and the chat about
 * a run that has ended. Neither reaches the run itself.
 *
 * The model conversation and its opening are made lazily, on the first
 * message, so opening the panel and closing it again costs nothing on the
 * server.
 */
export const AgentSideChat = ({
  title,
  hint,
  placeholder,
  opening,
  renderReply = reply => <p className={styles.output}>{reply || '…'}</p>,
  onClose,
  testId,
}: {
  title: string;
  hint: string;
  placeholder: string;
  /** The conversation's opening: what it is for and what it knows. */
  opening: () => Promise<ChatMessage[]>;
  renderReply?: (reply: string) => ReactNode;
  onClose?: () => void;
  testId: string;
}) => {
  const cloudRunner = useService(CloudAgentRunnerService);
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

  const start = useCallback(async (): Promise<ChatModel> => {
    if (model.current) return model.current;
    history.current = await opening();
    model.current = await cloudRunner.open(workspaceService.workspace.id);
    return model.current;
  }, [cloudRunner, opening, workspaceService]);

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
    <div className={styles.forkPanel} data-testid={testId}>
      <div className={styles.forkHead}>
        <span className={styles.questionLabel}>{title}</span>
        {onClose ? (
          <button
            className={styles.linkButton}
            onClick={onClose}
            data-testid={`${testId}-close`}
          >
            Close
          </button>
        ) : null}
      </div>
      <span className={styles.hint}>{hint}</span>

      {turns.length > 0 ? (
        <div className={styles.forkMessages}>
          {turns.map((turn, i) =>
            turn.role === 'user' ? (
              <p key={i} className={styles.forkUser}>
                {turn.content}
              </p>
            ) : (
              <div key={i} className={styles.forkReply}>
                {renderReply(turn.content)}
              </div>
            )
          )}
          <div ref={listEnd} />
        </div>
      ) : null}

      <textarea
        className={styles.questionInput}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={2}
        disabled={busy}
        autoFocus
        data-testid={`${testId}-input`}
      />
      <div className={styles.sessionActions}>
        <Button
          disabled={!canSend}
          onClick={() => {
            ask(text.trim()).catch(() => {});
          }}
          data-testid={`${testId}-send`}
        >
          {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
};
