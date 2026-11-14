import { Button } from '@notesgraph/component';
import { AgentRunLogDialog } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-log';
import {
  type Agent,
  type AgentRun,
  AgentRunsStore,
  canFixToMerge,
  fixRunFor,
  mergesDirectly,
  readyPulls,
  type ReleasePull,
  type ReleaseState,
} from '@notesgraph/core/modules/agents';
import { useLiveData, useService } from '@notesgraph/infra';
import { useMemo, useState } from 'react';

import { badgeClass, READINESS, TaskLinks } from './shared';
import * as styles from './styles.css';

/** What a pull request's Fix with Claude run is doing, for its row. */
const FIX_STATUS: Record<
  AgentRun['status'],
  { label: string; tone: 'good' | 'bad' | 'neutral' }
> = {
  running: { label: 'Claude is fixing it', tone: 'neutral' },
  done: { label: 'Claude finished', tone: 'good' },
  error: { label: 'Claude’s fix failed', tone: 'bad' },
  cancelled: { label: 'Claude’s fix was stopped', tone: 'neutral' },
};

/** The badge for a fix run: queued for a slot, or what FIX_STATUS says. */
const fixRunStatus = (run: AgentRun) =>
  run.status === 'running' && run.waitingForSlot
    ? {
        label: `Queued: waiting for a free slot on ${run.deviceKey ?? 'its device'}`,
        tone: 'neutral' as const,
      }
    : FIX_STATUS[run.status];

/**
 * How the fixes on the open pull requests stand, in a line: how many Claude
 * is working on and how many wait for a free slot on their device, so a
 * queue shows even before anyone opens a run.
 */
const FixSummary = ({ runs }: { runs: AgentRun[] }) => {
  const going = runs.filter(run => run.status === 'running');
  if (going.length === 0) return null;
  const waiting = going.filter(run => run.waitingForSlot);
  const devices = [
    ...new Set(waiting.map(run => run.deviceKey).filter(Boolean)),
  ].join(', ');
  return (
    <div className={styles.sectionHint} data-testid="release-fix-summary">
      Claude: {going.length - waiting.length} fixing
      {waiting.length > 0
        ? `, ${waiting.length} queued for a free slot${devices ? ` on ${devices}` : ''} (raise “Jobs at once” on the Monitoring page to run more at once)`
        : ''}
      .
    </div>
  );
};

/**
 * A pull request's Fix with Claude: the button, then, once a run is on it,
 * where that run is and "Show agent", which opens its window (the log as it
 * goes, its questions, a box to tell it more), as Monitoring's Fix it does.
 */
const FixAction = ({
  pr,
  run,
  busy,
  agent,
  onFix,
}: {
  pr: ReleasePull;
  run: AgentRun | undefined;
  busy: boolean;
  agent: Agent | undefined;
  onFix: (pr: ReleasePull) => void;
}) => {
  const [open, setOpen] = useState(false);
  const fixing = run?.status === 'running';
  return (
    <>
      <Button
        disabled={busy || !agent || fixing}
        tooltip={
          fixing
            ? 'Claude is already on it: Show agent follows it.'
            : agent
              ? `${agent.name} on ${agent.deviceKey} fixes it and merges it`
              : NO_FIX_AGENT
        }
        onClick={() => {
          onFix(pr);
          setOpen(true);
        }}
        data-testid="release-fix"
      >
        {fixing ? 'Fixing…' : run ? 'Fix again' : 'Fix with Claude'}
      </Button>
      {run ? (
        <Button
          variant="plain"
          onClick={() => setOpen(true)}
          tooltip={
            fixing
              ? 'Watch Claude fix it, answer its questions or tell it more.'
              : 'What Claude found and did.'
          }
          data-testid="release-fix-show"
        >
          Show agent
        </Button>
      ) : null}
      {run ? (
        <AgentRunLogDialog
          runId={open ? run.id : null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
};

/** Says where to add the agent "Fix with Claude" needs. */
export const NO_FIX_AGENT =
  'Fixing needs a Claude Code agent on a device with this repo: add one in Settings → Agents.';

/**
 * Pull requests open into the base branch, each with whether it merges, and
 * Merge or Fix with Claude.
 */
export const OpenPulls = ({
  state,
  busy,
  agent,
  onMerge,
  onMergeAll,
  onFix,
}: {
  state: ReleaseState;
  busy: boolean;
  /** The device agent Fix with Claude goes to; none disables it. */
  agent: Agent | undefined;
  onMerge: (pr: ReleasePull) => void;
  onMergeAll: (prs: ReleasePull[]) => void;
  onFix: (pr: ReleasePull) => void;
}) => {
  const base = state.settings?.baseBranch ?? 'stage';
  const ready = readyPulls(state.open);
  const runsStore = useService(AgentRunsStore);
  const runs = useLiveData(useMemo(() => runsStore.watchRuns(), [runsStore]));
  return (
    <section className={styles.section} data-testid="release-open">
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>
          Open pull requests
          <span className={styles.sectionCount}>{state.open.length}</span>
        </div>
        <Button
          disabled={busy || ready.length === 0}
          tooltip={
            ready.length === 0
              ? 'None is ready: drafts, conflicts and checks still running are left'
              : 'Failing checks don’t hold a merge up; drafts, conflicts and checks still running are left'
          }
          onClick={() => onMergeAll(ready)}
          data-testid="release-merge-all"
        >
          Merge all ready{ready.length > 0 ? ` (${ready.length})` : ''}
        </Button>
      </div>
      <FixSummary
        runs={state.open.flatMap(pr => {
          const run = fixRunFor(pr.url, runs ?? []);
          return run ? [run] : [];
        })}
      />
      {state.open.length === 0 ? (
        <div className={styles.empty}>No pull request is open into {base}.</div>
      ) : (
        <div className={styles.rows}>
          {state.open.map(pr => {
            const { label, tone } = READINESS[pr.readiness];
            const fixRun = fixRunFor(pr.url, runs ?? []);
            const fixStatus = fixRun ? fixRunStatus(fixRun) : null;
            return (
              <div
                key={pr.number}
                className={styles.row}
                data-testid="release-open-row"
              >
                <div className={styles.rowBody}>
                  <span className={styles.rowTitle}>
                    <a
                      className={styles.link}
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      #{pr.number}
                    </a>{' '}
                    {pr.title}
                  </span>
                  <span className={styles.rowMeta}>
                    <span className={badgeClass(tone)}>{label}</span>
                    {fixStatus ? (
                      <span
                        className={badgeClass(fixStatus.tone)}
                        data-testid="release-fix-status"
                      >
                        {fixStatus.label}
                      </span>
                    ) : null}
                    <span>{pr.branch}</span>
                    <span>{pr.author}</span>
                    <TaskLinks tasks={state.tasks[pr.number]} />
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {mergesDirectly(pr.readiness) ? (
                    <Button
                      disabled={busy}
                      onClick={() => onMerge(pr)}
                      data-testid="release-merge"
                    >
                      Merge
                    </Button>
                  ) : null}
                  {canFixToMerge(pr.readiness) || fixRun ? (
                    <FixAction
                      pr={pr}
                      run={fixRun}
                      busy={busy}
                      agent={agent}
                      onFix={onFix}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!agent && state.open.some(pr => canFixToMerge(pr.readiness)) ? (
        <div className={styles.sectionHint}>{NO_FIX_AGENT}</div>
      ) : null}
    </section>
  );
};
