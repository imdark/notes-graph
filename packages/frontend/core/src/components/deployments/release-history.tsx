import { Button, Input, Menu, MenuItem, notify } from '@notesgraph/component';
import {
  checkedCount,
  DeploymentsService,
  formatDuration,
  isCheckedStatus,
  type LiveCheck,
  type ReleaseRun,
  type ReleaseState,
  type ReleaseTask,
  runOutcome,
  sha7,
} from '@notesgraph/core/modules/agents';
import { useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import { errorMessage, pillClass, pullUrl, useOpenTask, when } from './shared';
import * as styles from './styles.css';

/** How many deploy runs History lists. */
const HISTORY_LIMIT = 15;

const taskKey = (task: Pick<ReleaseTask, 'docId' | 'blockId'>) =>
  `${task.docId}:${task.blockId}`;

/**
 * One task of a release, with Works / Doesn't work: what checking it live
 * found (DeploymentsService.recordCheck), lifted from the legacy view's
 * deployed rows.
 */
const CheckedTask = ({
  task,
  onChecked,
}: {
  task: ReleaseTask;
  onChecked: () => void;
}) => {
  const deployments = useService(DeploymentsService);
  const openTask = useOpenTask();
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const checked = isCheckedStatus(task.status);

  const record = useCallback(
    async (check: LiveCheck) => {
      setSaving(true);
      try {
        const recorded = await deployments.recordCheck(task, check);
        if (recorded) {
          notify.success({
            title: check.works ? 'Marked done' : 'Sent back to to-do',
            message: check.works
              ? `"${task.title}" works live.`
              : `"${task.title}" is a to-do again, with what's wrong noted under it.`,
          });
          setReporting(false);
          setProblem('');
          onChecked();
        } else {
          notify.error({
            title: "Couldn't record the check",
            message: `"${task.title}" isn't marked as shipping in its note any more.`,
          });
        }
      } catch (err) {
        notify.error({
          title: "Couldn't record the check",
          message: errorMessage(err),
        });
      } finally {
        setSaving(false);
      }
    },
    [deployments, onChecked, task]
  );

  return (
    <div className={styles.rowBody} data-testid="release-history-task">
      <span className={styles.rowMeta}>
        <button className={styles.link} onClick={() => openTask(task)}>
          ↳ task: {task.title || 'Untitled task'}
        </button>
        {task.status ? (
          <span className={checked ? styles.badgeGood : styles.badge}>
            {checked ? 'checked' : task.status.toUpperCase()}
          </span>
        ) : null}
      </span>
      {checked ? null : reporting ? (
        <div className={styles.problemForm}>
          <Input
            className={styles.problemInput}
            autoFocus
            value={problem}
            onChange={setProblem}
            onEnter={() => void record({ works: false, problem })}
            placeholder="What's wrong? (optional)"
            disabled={saving}
            data-testid="release-problem"
          />
          <Button
            variant="primary"
            onClick={() => void record({ works: false, problem })}
            loading={saving}
            data-testid="release-send-back"
          >
            Send back
          </Button>
          <Button
            variant="plain"
            onClick={() => setReporting(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className={styles.rowActions}>
          <Button
            variant="primary"
            onClick={() => void record({ works: true })}
            loading={saving}
            tooltip="Seen it working live: marks it done"
            data-testid="release-works"
          >
            Works
          </Button>
          <Button
            onClick={() => {
              setProblem('');
              setReporting(true);
            }}
            disabled={saving}
            tooltip="Sends it back to to-do, with what's wrong noted under it"
            data-testid="release-broken"
          >
            Doesn&apos;t work
          </Button>
        </div>
      )}
    </div>
  );
};

const HistoryRow = ({
  run,
  state,
  busy,
  open,
  onToggle,
  onRedeployThis,
  onChecked,
}: {
  run: ReleaseRun;
  state: ReleaseState;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onRedeployThis: (imageSha: string) => void;
  onChecked: () => void;
}) => {
  const outcome = runOutcome(run);
  const { checked, total } = checkedCount(run.prs, state.tasks);
  const succeeded = run.status === 'completed' && run.conclusion === 'success';
  return (
    <div className={styles.historyRow} data-testid="release-history-row">
      <div className={styles.row} style={{ padding: 0 }}>
        <button
          className={styles.historyToggle}
          onClick={onToggle}
          aria-expanded={open}
        >
          <span>{open ? '▾' : '▸'}</span>
          <code className={styles.sha}>{sha7(run.rollbackTo ?? run.sha)}</code>
          <span>{when(run.startedAt)}</span>
          <span className={pillClass(outcome.tone)}>
            {outcome.label}
            {run.durationMs ? ` ${formatDuration(run.durationMs)}` : ''}
          </span>
          {run.rollbackTo ? (
            <span className={styles.badge}>rollback</span>
          ) : (
            <span>
              {run.prs.length} PR{run.prs.length === 1 ? '' : 's'}
            </span>
          )}
          {total > 0 ? (
            <span>
              checked {checked}/{total}
            </span>
          ) : null}
        </button>
        <Menu
          items={
            <>
              {succeeded ? (
                <MenuItem
                  disabled={busy}
                  onClick={() => onRedeployThis(run.rollbackTo ?? run.sha)}
                  data-testid="release-redeploy-this"
                >
                  Redeploy this
                </MenuItem>
              ) : null}
              <MenuItem
                onClick={() => {
                  window.open(run.url, '_blank', 'noreferrer');
                }}
              >
                Open run
              </MenuItem>
            </>
          }
        >
          <Button variant="plain" aria-label="More" data-testid="release-more">
            ⋯
          </Button>
        </Menu>
      </div>
      {open ? (
        <div className={styles.historyBody}>
          {run.rollbackTo ? (
            <span className={styles.sectionHint}>
              Rolled prod back to the image of {sha7(run.rollbackTo)}; it
              shipped no pull request of its own.
            </span>
          ) : run.prs.length === 0 ? (
            <span className={styles.sectionHint}>
              No merged pull request since the release before it.
            </span>
          ) : (
            run.prs.map(number => {
              const url = pullUrl(state, number);
              const tasks = state.tasks[number] ?? [];
              return (
                <div key={number} className={styles.rowBody}>
                  <span className={styles.rowTitle}>
                    {url ? (
                      <a
                        className={styles.link}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        #{number}
                      </a>
                    ) : (
                      `#${number}`
                    )}
                  </span>
                  {tasks.length === 0 ? (
                    <span className={styles.sectionHint}>
                      No task links this pull request.
                    </span>
                  ) : (
                    tasks.map(task => (
                      <CheckedTask
                        key={taskKey(task)}
                        task={task}
                        onChecked={onChecked}
                      />
                    ))
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
};

/** The deploy workflow's latest runs, each opening to what it shipped. */
export const ReleaseHistory = ({
  state,
  busy,
  onRedeployThis,
  onChecked,
}: {
  state: ReleaseState;
  busy: boolean;
  onRedeployThis: (imageSha: string) => void;
  onChecked: () => void;
}) => {
  const [open, setOpen] = useState<number | null>(null);
  const runs = state.history.slice(0, HISTORY_LIMIT);
  return (
    <section className={styles.section} data-testid="release-history">
      <div className={styles.sectionTitle}>History</div>
      {runs.length === 0 ? (
        <div className={styles.empty}>
          No run of {state.settings?.workflowFile ?? 'the deploy workflow'} yet.
        </div>
      ) : (
        <div className={styles.rows}>
          {runs.map(run => (
            <HistoryRow
              key={run.id}
              run={run}
              state={state}
              busy={busy}
              open={open === run.id}
              onToggle={() => setOpen(open === run.id ? null : run.id)}
              onRedeployThis={onRedeployThis}
              onChecked={onChecked}
            />
          ))}
        </div>
      )}
    </section>
  );
};
