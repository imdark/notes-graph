import { Button, notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
} from '@notesgraph/core/modules/agents';
import { useLiveData, useService } from '@notesgraph/infra';
import clsx from 'clsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

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
  /** Show what the run changed: the run's Changes tab. */
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

  const summary = run.summary?.trim() || `${run.agentName} finished.`;
  // Past four lines the answer is cut, and More opens the whole summary.
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = summaryRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [summary]);

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
      <p
        ref={summaryRef}
        className={clsx(styles.questionText, styles.reviewSummary)}
      >
        {summary}
      </p>
      {clamped ? (
        <button
          className={styles.reviewMore}
          onClick={() => onReview(run.id)}
          data-testid="agent-review-more"
        >
          More
        </button>
      ) : null}
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
          tooltip="What it did: a summary, the notes it created or edited, and the diff of its project changes"
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
