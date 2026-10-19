import { Button, notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
} from '@notesgraph/core/modules/agents';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './agents.css';

/**
 * A run that finished and waits for the reader, shown where questions are:
 * approve its work, read what it did, or ask it about it. It stays until
 * approved, here and on the reader's other devices, since the flag is on the
 * run's synced row.
 */
export const AgentReviewCard = ({
  run,
  onReview,
  onAsk,
}: {
  run: AgentRun;
  /** Show what the run did: its log. */
  onReview: (runId: string) => void;
  /** Open a chat about the run (see AgentRunChat). */
  onAsk: (runId: string) => void;
}) => {
  const runsStore = useService(AgentRunsStore);
  const sessionService = useService(AgentRunSessionService);

  const sessions = useLiveData(sessionService.sessions$);
  // Ran in this tab: it can be undone while the tab keeps its snapshot.
  const session = sessions.find(s => s.runId === run.id);
  const undoable = !!session && sessionService.canUndo(session.id);
  const [undoing, setUndoing] = useState(false);

  const approve = useCallback(() => {
    runsStore.settleReview(run.id);
    // Its work is kept, so the undo snapshot can go.
    if (session) sessionService.keep(session.id);
  }, [run.id, runsStore, session, sessionService]);

  const undo = useCallback(() => {
    if (!session) return;
    setUndoing(true);
    sessionService
      .undo(session.id)
      .then(undone => {
        if (undone) runsStore.settleReview(run.id);
        else notify.error({ title: 'Could not undo this run' });
      })
      .catch(() => notify.error({ title: 'Could not undo this run' }))
      .finally(() => setUndoing(false));
  }, [run.id, runsStore, session, sessionService]);

  return (
    <div className={styles.questionCard} data-testid="agent-review">
      <span className={styles.questionLabel}>Done · review</span>
      <p className={styles.questionText}>
        {run.summary?.trim() || `${run.agentName} finished.`}
      </p>
      <div className={styles.sessionActions}>
        <Button
          variant="primary"
          onClick={approve}
          data-testid="agent-review-approve"
        >
          Approve
        </Button>
        <Button
          onClick={() => onReview(run.id)}
          tooltip="Read its log: each step it took and each tool it ran"
          data-testid="agent-review-changes"
        >
          Review changes
        </Button>
        <Button
          onClick={() => onAsk(run.id)}
          tooltip="Ask what it did, why, or what is left"
          data-testid="agent-review-ask"
        >
          Ask
        </Button>
        {undoable ? (
          <Button
            variant="plain"
            onClick={undo}
            loading={undoing}
            disabled={undoing}
            tooltip="Put the note back as it was before this run"
            data-testid="agent-review-undo"
          >
            Undo
          </Button>
        ) : null}
      </div>
    </div>
  );
};
