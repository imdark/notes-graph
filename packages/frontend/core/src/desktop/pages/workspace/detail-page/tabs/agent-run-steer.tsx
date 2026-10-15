import { Button } from '@notesgraph/component';
import {
  RemoteAgentRunnerService,
  type RemoteSteer,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';

import * as styles from './agents.css';

/**
 * "Send to run": tell a running device job something mid-way. The server
 * queues it, the runner takes it on its next step, and the server writes it
 * into the transcript then, so a delivered message shows in the log itself.
 * Until then it is listed here as waiting.
 */
export const AgentRunSteer = ({
  jobId,
  steers,
}: {
  jobId: string;
  /** Every message the job has been sent, from its last poll. */
  steers: RemoteSteer[];
}) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sent from here but not yet in a poll; a poll then reports it either way.
  const [sent, setSent] = useState<RemoteSteer[]>([]);
  useEffect(() => setSent([]), [jobId]);

  const known = new Set(steers.map(s => s.id));
  const waiting = [
    ...steers.filter(s => !s.deliveredAt),
    ...sent.filter(s => !known.has(s.id)),
  ];

  const canSend = text.trim().length > 0 && !sending;
  const send = useCallback(() => {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    remoteRunner
      .steer(workspaceService.workspace.id, jobId, message)
      .then(steer => {
        setSent(prev => [...prev, steer]);
        setText('');
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSending(false));
  }, [jobId, remoteRunner, text, workspaceService]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends, as in a chat; Shift+Enter is a new line.
      if (e.key === 'Enter' && !e.shiftKey && canSend) {
        e.preventDefault();
        send();
      }
    },
    [canSend, send]
  );

  return (
    <div className={styles.logDialogBody} data-testid="agent-run-steer">
      {waiting.map(steer => (
        <span
          key={steer.id}
          className={styles.hint}
          data-testid="agent-run-steer-waiting"
        >
          Waiting for the agent’s next step: {steer.text}
        </span>
      ))}
      <textarea
        className={styles.questionInput}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Tell the agent something…"
        rows={1}
        disabled={sending}
        data-testid="agent-run-steer-input"
      />
      <div className={styles.sessionActions}>
        <Button
          variant="primary"
          disabled={!canSend}
          onClick={send}
          data-testid="agent-run-steer-send"
        >
          Send
        </Button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
};
