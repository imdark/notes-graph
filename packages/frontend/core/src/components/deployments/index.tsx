import { Button, Checkbox, notify } from '@notesgraph/component';
import {
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
  agentTargetKey,
  canFixToMerge,
  type DeployInfo,
  DeploymentsService,
  type MergeReadiness,
  mergeReadiness,
  mergesDirectly,
  type PullRequest,
  pullRequestNumber,
  pullRequestStage,
  repoOf,
  type ShipAction,
  shipAgents,
  type ShipStage,
  shipTargets,
  type ShipTask,
  type ShipTaskDetails,
  stuckReason,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './styles.css';

type Row = ShipTask &
  ShipTaskDetails & {
    /** Why a COMMITTED task has nothing to merge; see stuckReason. */
    stuck: string | null;
  };

const READINESS: Record<
  MergeReadiness,
  { label: string; tone: 'good' | 'bad' | 'neutral' }
> = {
  ready: { label: 'Ready', tone: 'good' },
  unknown: { label: 'Mergeable?', tone: 'neutral' },
  conflicts: { label: 'Conflicts', tone: 'bad' },
  failing: { label: 'Checks failing', tone: 'bad' },
  pending: { label: 'Checks running', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'neutral' },
};

const badgeClass = (tone: 'good' | 'bad' | 'neutral') =>
  tone === 'good'
    ? styles.badgeGood
    : tone === 'bad'
      ? styles.badgeBad
      : styles.badge;

const minutesAgo = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
};

const SECTIONS: { stage: ShipStage; title: string; hint: string }[] = [
  {
    stage: 'committed',
    title: 'Ready to merge',
    hint: 'Pull requests open. wf merges them on GitHub itself; ones that conflict go to Claude Code to fix first.',
  },
  {
    stage: 'merged',
    title: 'Ready to deploy',
    hint: 'On main, not live yet',
  },
  {
    stage: 'deployed',
    title: 'Live, waiting to be checked',
    hint: 'Mark done once you have seen it working',
  },
];

const rowKey = (task: { docId: string; blockId: string }) =>
  `${task.docId}:${task.blockId}`;

/** The pull request's repo-and-number, which is all a row needs to show. */
const prLabel = (url: string) => {
  const match = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url);
  return match ? `${match[1]} #${match[2]}` : 'Pull request';
};

/**
 * Where a row's pull request is, as a badge: checked against GitHub and,
 * once merged, against the build prod says it runs.
 */
const PullBadge = ({
  pr,
  deploy,
}: {
  pr: PullRequest | undefined;
  deploy: DeployInfo | null;
}) => {
  if (!pr) return null;
  if (pr.state === 'merged') {
    const stage = pullRequestStage(pr, deploy);
    if (stage === 'deployed') {
      return <span className={styles.badgeGood}>Deployed</span>;
    }
    if (stage === 'merged') {
      return <span className={styles.badge}>Merged · not deployed</span>;
    }
    return <span className={styles.badgeGood}>Merged on GitHub</span>;
  }
  const { label, tone } = READINESS[mergeReadiness(pr)];
  return <span className={badgeClass(tone)}>{label}</span>;
};

/**
 * A task marked DEPLOYED whose pull request isn't in prod's build: an agent
 * said so, or the deploy that had it was rolled back.
 */
const NotLiveBadge = ({
  pr,
  deploy,
}: {
  pr: PullRequest | undefined;
  deploy: DeployInfo | null;
}) => {
  if (!pr) return null;
  const stage = pullRequestStage(pr, deploy);
  if (stage === 'deployed' || stage === null) return null;
  return (
    <span className={styles.badgeBad} data-testid="deployments-not-live">
      Marked deployed, not on prod
    </span>
  );
};

/** What prod runs, so a merge can be checked for being live. */
const ProdLine = ({ deploy }: { deploy: DeployInfo | null | undefined }) => {
  if (deploy === undefined) return null;
  if (deploy === null) {
    return (
      <div className={styles.sectionHint} data-testid="deployments-prod">
        This server keeps no deploy record, so merged pull requests can&apos;t
        be checked for being live. It starts with the next deploy.
      </div>
    );
  }
  return (
    <div className={styles.sectionHint} data-testid="deployments-prod">
      Prod runs <code>{deploy.commit.slice(0, 7)}</code> ({deploy.subject}),
      deployed {new Date(deploy.deployedAt).toLocaleString()}
      {deploy.dirty ? ', with uncommitted changes on top' : ''}.
    </div>
  );
};

/**
 * Features ready to go out, and the pull requests behind them.
 *
 * Tasks marked COMMITTED (PR open), MERGED (on main) or DEPLOYED (live,
 * unchecked) come from the notes; what GitHub says of their pull requests —
 * and open ones no task names — comes from wf on the ship agent's device,
 * which runs `gh` there. Clean pull requests wf merges itself; ones that
 * conflict or fail go to Claude Code on that device to fix and merge, and a
 * deploy goes to it too. Shared by the desktop page and the phone's, which is
 * where it is most often used.
 */
export const DeploymentsView = () => {
  const deployments = useService(DeploymentsService);
  const agentsService = useService(AgentsService);
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;

  const tasks = useLiveData(deployments.tasks$);
  const github = useLiveData(deployments.pullRequests$);
  const deployInfo = useLiveData(deployments.deployInfo$);
  const deploy = deployInfo ?? null;
  // Read on open too, not only with the pull requests (which need an agent).
  useEffect(() => {
    deployments.refreshDeployInfo().catch(() => {});
  }, [deployments]);
  const agents = useLiveData(agentsService.agents$);
  const candidates = useMemo(() => shipAgents(agents), [agents]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const agent =
    candidates.find(candidate => candidate.id === agentId) ?? candidates[0];

  // What reading each task's note adds. Re-read whenever the index's list
  // changes, which is also when an agent moves a task on.
  const [details, setDetails] = useState<Map<
    string,
    ShipTaskDetails & { stage: ShipStage }
  > | null>(null);
  // Bumped when this screen moved tasks on itself, so their notes are read
  // again now rather than whenever the index catches up.
  const [notesChanged, setNotesChanged] = useState(0);
  const branchChecks = useLiveData(deployments.branchChecks$);
  useEffect(() => {
    if (!tasks) return;
    let cancelled = false;
    deployments
      .details(tasks)
      .then(read => {
        if (!cancelled) setDetails(read);
      })
      .catch(() => {
        if (!cancelled) setDetails(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [deployments, tasks, notesChanged]);

  const pullsByUrl = useMemo(
    () => new Map(github.pulls.map(pr => [pr.url, pr])),
    [github.pulls]
  );

  const rows = useMemo<Row[]>(
    () =>
      (tasks ?? []).flatMap(task => {
        const read = details?.get(rowKey(task));
        // Read but gone from its note, or no longer in a ship stage there.
        if (details && !read) return [];
        const pullRequest = read?.pullRequest ?? null;
        const noted = read?.stage ?? task.stage;
        const check = pullRequest ? branchChecks.get(pullRequest) : undefined;
        // Merged on GitHub by someone else: it is waiting for a deploy. The
        // list has only recent merges; an older one is known from a check.
        const stage =
          noted === 'committed' &&
          pullRequest &&
          (pullsByUrl.get(pullRequest)?.state === 'merged' ||
            check?.state === 'merged')
            ? 'merged'
            : noted;
        return [
          {
            ...task,
            stage,
            title: read?.title ?? task.text,
            docTitle: read?.docTitle ?? '',
            pullRequest,
            stuck: stuckReason({ stage, pullRequest }, check),
          },
        ];
      }),
    [tasks, details, pullsByUrl, branchChecks]
  );

  // The repos the tasks' pull requests are in: what to ask GitHub about.
  // Keyed by their names, so re-reading the same notes doesn't ask again.
  const reposKey = [
    ...new Set(
      rows.flatMap(row => {
        const repo = row.pullRequest ? repoOf(row.pullRequest) : null;
        return repo ? [repo] : [];
      })
    ),
  ]
    .sort()
    .join(',');
  const repos = useMemo(
    () => (reposKey ? reposKey.split(',') : []),
    [reposKey]
  );
  const refresh = useCallback(() => {
    if (agent) deployments.refreshPullRequests(agent, repos).catch(() => {});
  }, [agent, deployments, repos]);
  // Once the notes are read, so the repos are known.
  const notesRead = details !== null;
  useEffect(() => {
    if (notesRead) refresh();
  }, [notesRead, refresh]);

  // Open pull requests no task names, and merged ones no task names.
  const named = useMemo(
    () =>
      new Set(rows.flatMap(row => (row.pullRequest ? [row.pullRequest] : []))),
    [rows]
  );
  const untrackedOpen = github.pulls.filter(
    pr => pr.state === 'open' && !named.has(pr.url)
  );
  const untrackedMerged = github.pulls
    .filter(pr => pr.state === 'merged' && !named.has(pr.url))
    .sort((a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0));

  // Every task ready to ship starts chosen; unticking one leaves it out.
  const [unchosen, setUnchosen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string, checked: boolean) => {
    setUnchosen(prev => {
      const next = new Set(prev);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const chosen = useMemo(
    () => rows.filter(row => !unchosen.has(rowKey(row))),
    [rows, unchosen]
  );
  // A task with nothing open to merge isn't sent to merge or deploy.
  const chosenToShip = chosen.filter(row => !row.stuck);
  const toMerge = shipTargets(chosenToShip, 'merge');
  const toDeploy = shipTargets(chosenToShip, 'deploy');
  const stuck = rows.filter(row => row.stuck);

  // Moved on by hand, for a task whose work is on main already or done.
  const [moving, setMoving] = useState<Set<string>>(() => new Set());
  const moveOn = useCallback(
    async (row: Row, status: 'MERGED' | 'DONE') => {
      const key = rowKey(row);
      setMoving(prev => new Set(prev).add(key));
      try {
        const moved = await deployments.moveOn(row, status);
        if (!moved) {
          notify.error({
            title: `Couldn't mark it ${status.toLowerCase()}`,
            message: `"${row.title}" isn't COMMITTED in its note any more.`,
          });
        }
        setNotesChanged(n => n + 1);
      } catch (err) {
        notify.error({
          title: `Couldn't mark it ${status.toLowerCase()}`,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setMoving(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [deployments]
  );

  // The run this screen last sent, followed here so a phone sees it through.
  const [sent, setSent] = useState<{
    agentId: string;
    target: AgentTarget;
  } | null>(null);
  const allSessions = useLiveData(sessions.sessions$);
  const session = useMemo(
    () =>
      sent
        ? allSessions.find(
            s =>
              s.agentId === sent.agentId &&
              agentTargetKey(s.target) === agentTargetKey(sent.target)
          )
        : undefined,
    [allSessions, sent]
  );

  // Pull requests wf is merging right now, by URL.
  const [merging, setMerging] = useState<Set<string>>(() => new Set());
  const busy = merging.size > 0 || !!session?.running;

  /** Merge through wf, no AI. Resolves to whether it merged. */
  const mergeOne = useCallback(
    async (pr: PullRequest, task?: Row): Promise<boolean> => {
      if (!agent) return false;
      setMerging(prev => new Set(prev).add(pr.url));
      try {
        await deployments.merge(agent, pr, task);
        return true;
      } catch (err) {
        notify.error({
          title: `Couldn't merge ${prLabel(pr.url)}`,
          message: err instanceof Error ? err.message : String(err),
        });
        return false;
      } finally {
        setMerging(prev => {
          const next = new Set(prev);
          next.delete(pr.url);
          return next;
        });
      }
    },
    [agent, deployments]
  );

  // What "Ready to merge" lists that GitHub can be asked about: the tasks
  // with a pull request, and the open pull requests no task names.
  const readyItems = useMemo(
    () => [
      ...rows.flatMap(row => {
        if (row.stage !== 'committed' || !row.pullRequest) return [];
        const repo = repoOf(row.pullRequest);
        const number = pullRequestNumber(row.pullRequest);
        return repo && number
          ? [{ pr: { repo, number, url: row.pullRequest }, task: row }]
          : [];
      }),
      ...untrackedOpen.map(pr => ({ pr })),
    ],
    [rows, untrackedOpen]
  );
  const [checking, setChecking] = useState(false);

  /**
   * Check the ready-to-merge branches on GitHub: a merged one's branch is
   * deleted and its task moves on; anything gone or closed is reported.
   */
  const checkBranches = useCallback(async () => {
    if (!agent) return;
    setChecking(true);
    try {
      const { checks, deleted, failed } = await deployments.checkReadyBranches(
        agent,
        readyItems
      );
      const label = (c: { repo: string; number: number }) => `#${c.number}`;
      const merged = checks.filter(c => c.state === 'merged');
      const closed = checks.filter(c => c.state === 'closed');
      const missing = checks.filter(c => c.state === 'missing');
      const noBranch = checks.filter(
        c => c.state === 'open' && !c.branchExists
      );
      const lines = [
        merged.length
          ? `Already merged: ${merged.map(label).join(', ')}${deleted.length ? ` (deleted ${deleted.length} branch${deleted.length === 1 ? '' : 'es'})` : ''}.`
          : null,
        failed.length ? `Couldn't delete: ${failed.join(', ')}.` : null,
        closed.length
          ? `Closed without merging: ${closed.map(label).join(', ')}.`
          : null,
        missing.length
          ? `No longer on GitHub: ${missing.map(label).join(', ')}.`
          : null,
        noBranch.length
          ? `Open but the branch is gone: ${noBranch.map(label).join(', ')}.`
          : null,
      ].filter(Boolean);
      const ok =
        checks.length -
        merged.length -
        closed.length -
        missing.length -
        noBranch.length;
      (failed.length ? notify.error : notify.success)({
        title: `Checked ${checks.length} ready branch${checks.length === 1 ? '' : 'es'}`,
        message:
          lines.length > 0
            ? `${lines.join(' ')}${ok > 0 ? ` ${ok} still open and ready.` : ''}`
            : 'All still open, with their branches.',
      });
      // Merged ones were moved on in their notes; show that now.
      setNotesChanged(n => n + 1);
      refresh();
    } catch (err) {
      notify.error({
        title: "Couldn't check the branches",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setChecking(false);
    }
  }, [agent, deployments, readyItems, refresh]);

  /** Hand to Claude Code on the device: to fix and merge, or to deploy. */
  const sendToClaude = useCallback(
    async (
      action: ShipAction,
      taskRows: Row[],
      untracked: PullRequest[] = []
    ) => {
      if (!agent) return;
      try {
        const target = await deployments.ship(
          agent,
          taskRows,
          action,
          { pulls: github.pulls, untracked },
          rows[0]
        );
        if (!target) return;
        setSent({ agentId: agent.id, target });
        notify.success({
          title: action === 'merge' ? 'Sent to Claude to merge' : 'Deploy sent',
          message: `${agent.name} on ${agent.deviceKey} is on it. Questions it asks come to you as notifications.`,
        });
      } catch (err) {
        notify.error({
          title: "Couldn't send it",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [agent, deployments, github.pulls, rows]
  );

  /**
   * Merge the chosen tasks' pull requests: wf merges each GitHub says is
   * clean; the rest — and any that fail to — go to Claude Code. For a
   * deploy, the deploy goes to Claude Code after, with whatever is merged.
   */
  const ship = useCallback(
    async (action: ShipAction) => {
      const helpNeeded: Row[] = [];
      const mergedNow = new Set<string>();
      for (const row of toMerge) {
        const pr = row.pullRequest
          ? pullsByUrl.get(row.pullRequest)
          : undefined;
        const readiness = pr?.state === 'open' ? mergeReadiness(pr) : null;
        if (
          pr &&
          readiness &&
          mergesDirectly(readiness) &&
          (await mergeOne(pr, row))
        ) {
          mergedNow.add(rowKey(row));
          continue;
        }
        // A draft isn't ready to go, whoever merges it.
        if (readiness !== 'draft') helpNeeded.push(row);
      }
      if (action === 'merge') {
        if (helpNeeded.length > 0) await sendToClaude('merge', helpNeeded);
        else if (mergedNow.size > 0) {
          notify.success({
            title: `Merged ${mergedNow.size}`,
            message: 'wf merged them on GitHub; their tasks are MERGED.',
          });
        }
        refresh();
        return;
      }
      await sendToClaude(
        'deploy',
        toDeploy.map(row =>
          mergedNow.has(rowKey(row)) ? { ...row, stage: 'merged' } : row
        )
      );
    },
    [mergeOne, pullsByUrl, refresh, sendToClaude, toDeploy, toMerge]
  );

  const openTask = useCallback(
    (row: Row) => {
      workbench.openDoc(
        {
          docId: row.docId,
          mode: 'page',
          blockIds: [row.blockId],
          refreshKey: 'deploy-' + Date.now(),
        },
        { at: 'active' }
      );
    },
    [workbench]
  );

  if (!tasks) {
    return <div className={styles.empty}>Looking for features to ship…</div>;
  }

  const shippable =
    rows.some(row => row.stage !== 'deployed' && !row.stuck) ||
    untrackedOpen.length > 0;

  /** Merge buttons for an open pull request: wf's, or Claude's to fix it. */
  const mergeActions = (pr: PullRequest | undefined, row?: Row) => {
    if (!agent || !pr || pr.state !== 'open') return null;
    const readiness = mergeReadiness(pr);
    return (
      <div className={styles.rowActions}>
        {mergesDirectly(readiness) ? (
          <Button
            size="default"
            disabled={busy}
            loading={merging.has(pr.url)}
            onClick={() => {
              mergeOne(pr, row)
                .then(ok => {
                  if (ok) refresh();
                })
                .catch(() => {});
            }}
            data-testid="deployments-merge-one"
          >
            Merge
          </Button>
        ) : null}
        {canFixToMerge(readiness) && (row || rows.length > 0) ? (
          <Button
            size="default"
            disabled={busy}
            onClick={() => {
              sendToClaude('merge', row ? [row] : [], row ? [] : [pr]).catch(
                () => {}
              );
            }}
            data-testid="deployments-fix-one"
          >
            Fix & merge with Claude
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.content} data-testid="deployments-view">
      <ProdLine deploy={deployInfo} />
      {shippable ? (
        candidates.length > 0 && agent ? (
          <div className={styles.shipBar}>
            {candidates.length > 1 ? (
              <select
                className={styles.agentSelect}
                value={agent.id}
                onChange={event => setAgentId(event.target.value)}
                aria-label="Agent to ship with"
                data-testid="deployments-agent"
              >
                {candidates.map(candidate => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} · {candidate.deviceKey}
                  </option>
                ))}
              </select>
            ) : (
              <span className={styles.sectionHint} style={{ flex: 1 }}>
                With {agent.name} on {agent.deviceKey}
              </span>
            )}
            <Button
              disabled={toMerge.length === 0 || busy}
              onClick={() => {
                ship('merge').catch(() => {});
              }}
              data-testid="deployments-merge"
            >
              Merge ({toMerge.length})
            </Button>
            <Button
              variant="primary"
              disabled={toDeploy.length === 0 || busy}
              onClick={() => {
                ship('deploy').catch(() => {});
              }}
              data-testid="deployments-deploy"
            >
              {toMerge.length > 0 ? 'Merge & deploy' : 'Deploy'} (
              {toDeploy.length})
            </Button>
          </div>
        ) : (
          <div className={styles.empty}>
            To ship from here, add an agent that runs Claude Code on a device
            with this repo, in Settings → Agents.
          </div>
        )
      ) : null}

      {agent ? (
        <div className={styles.githubBar} data-testid="deployments-github">
          <span>
            {github.loading
              ? `Asking GitHub through wf on ${agent.deviceKey}…`
              : github.at
                ? `GitHub via wf on ${agent.deviceKey}, ${minutesAgo(github.at)}`
                : `GitHub via wf on ${agent.deviceKey}`}
          </span>
          <button
            className={styles.link}
            disabled={github.loading}
            onClick={refresh}
            data-testid="deployments-refresh"
          >
            Refresh
          </button>
          {readyItems.length > 0 ? (
            <button
              className={styles.link}
              disabled={checking || busy || github.loading}
              onClick={() => {
                checkBranches().catch(() => {});
              }}
              title="Ask GitHub whether each ready-to-merge pull request still exists and is still unmerged. Merged ones have their branch deleted and their task moved to MERGED."
              data-testid="deployments-check-branches"
            >
              {checking
                ? 'Checking branches…'
                : `Check ready branches (${readyItems.length})`}
            </button>
          ) : null}
          {github.error ? (
            <span className={styles.runError}>{github.error}</span>
          ) : null}
        </div>
      ) : null}

      {session ? (
        <div className={styles.runStatus} data-testid="deployments-run">
          {session.running
            ? session.questions.length > 0
              ? `${session.agentName} is waiting for your answer.`
              : `${session.agentName} is working on it…`
            : session.error
              ? null
              : `${session.agentName} finished.`}
          {session.error ? (
            <span className={styles.runError}>{session.error}</span>
          ) : null}
          {!session.running && session.output ? `\n${session.output}` : null}
        </div>
      ) : null}

      {rows.length === 0 && untrackedOpen.length === 0 ? (
        <div className={styles.empty}>
          Nothing to ship. Tasks show up here when an agent marks them
          COMMITTED, MERGED or DEPLOYED, and pull requests once GitHub has them
          open.
        </div>
      ) : null}

      {SECTIONS.map(({ stage, title, hint }) => {
        const list = rows.filter(row => row.stage === stage && !row.stuck);
        const extra = stage === 'committed' ? untrackedOpen : [];
        if (list.length === 0 && extra.length === 0) return null;
        return (
          <section
            key={stage}
            className={styles.section}
            data-testid={`deployments-${stage}`}
          >
            <div className={styles.sectionTitle}>
              {title}
              <span className={styles.sectionCount}>
                {list.length + extra.length}
              </span>
            </div>
            <div className={styles.sectionHint}>{hint}</div>
            <div className={styles.rows}>
              {list.map(row => {
                const key = rowKey(row);
                const pr = row.pullRequest
                  ? pullsByUrl.get(row.pullRequest)
                  : undefined;
                return (
                  <div key={key} className={styles.row}>
                    {stage === 'deployed' ? null : (
                      <Checkbox
                        checked={!unchosen.has(key)}
                        onChange={(_, checked) => toggle(key, checked)}
                        aria-label={`Ship ${row.title}`}
                      />
                    )}
                    <div className={styles.rowBody}>
                      <span className={styles.rowTitle}>{row.title}</span>
                      <span className={styles.rowMeta}>
                        <button
                          className={styles.link}
                          onClick={() => openTask(row)}
                        >
                          {row.docTitle || 'Open note'}
                        </button>
                        {row.pullRequest ? (
                          <a
                            className={styles.link}
                            href={row.pullRequest}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {prLabel(row.pullRequest)}
                          </a>
                        ) : (
                          <span>No PR link</span>
                        )}
                        {stage === 'deployed' ? (
                          <NotLiveBadge pr={pr} deploy={deploy} />
                        ) : (
                          <PullBadge pr={pr} deploy={deploy} />
                        )}
                      </span>
                    </div>
                    {stage === 'committed' ? mergeActions(pr, row) : null}
                  </div>
                );
              })}
              {extra.map(pr => (
                <div
                  key={pr.url}
                  className={styles.row}
                  data-testid="deployments-untracked"
                >
                  <div className={styles.rowBody}>
                    <span className={styles.rowTitle}>{pr.title}</span>
                    <span className={styles.rowMeta}>
                      <a
                        className={styles.link}
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {prLabel(pr.url)}
                      </a>
                      <span>{pr.branch}</span>
                      <span>No task</span>
                      <PullBadge pr={pr} deploy={deploy} />
                    </span>
                  </div>
                  {mergeActions(pr)}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {stuck.length > 0 ? (
        <section className={styles.section} data-testid="deployments-stuck">
          <div className={styles.sectionTitle}>
            Not ready to merge
            <span className={styles.sectionCount}>{stuck.length}</span>
          </div>
          <div className={styles.sectionHint}>
            Marked COMMITTED, but there is nothing open to merge: no pull
            request in the note, or Check ready branches found it closed, gone
            or without its branch. Mark it merged if the work is on main another
            way, or done if nothing is left to ship.
          </div>
          <div className={styles.rows}>
            {stuck.map(row => {
              const key = rowKey(row);
              const busyRow = moving.has(key);
              return (
                <div key={key} className={styles.row}>
                  <div className={styles.rowBody}>
                    <span className={styles.rowTitle}>{row.title}</span>
                    <span className={styles.rowMeta}>
                      <button
                        className={styles.link}
                        onClick={() => openTask(row)}
                      >
                        {row.docTitle || 'Open note'}
                      </button>
                      {row.pullRequest ? (
                        <a
                          className={styles.link}
                          href={row.pullRequest}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {prLabel(row.pullRequest)}
                        </a>
                      ) : null}
                      <span className={styles.badgeBad}>{row.stuck}</span>
                    </span>
                  </div>
                  <div className={styles.rowActions}>
                    <Button
                      onClick={() => void moveOn(row, 'MERGED')}
                      disabled={busyRow}
                      tooltip="Its work is on main already: it moves to Ready to deploy"
                      data-testid="deployments-stuck-merged"
                    >
                      Mark merged
                    </Button>
                    <Button
                      variant="plain"
                      onClick={() => void moveOn(row, 'DONE')}
                      disabled={busyRow}
                      tooltip="Nothing left to ship: it leaves this screen"
                      data-testid="deployments-stuck-done"
                    >
                      Mark done
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {untrackedMerged.length > 0 ? (
        <section
          className={styles.section}
          data-testid="deployments-merged-untracked"
        >
          <div className={styles.sectionTitle}>
            Merged recently, no task
            <span className={styles.sectionCount}>
              {untrackedMerged.length}
            </span>
          </div>
          <div className={styles.sectionHint}>
            On main; a deploy takes them out with everything else there.
          </div>
          <div className={styles.rows}>
            {untrackedMerged.map(pr => (
              <div key={pr.url} className={styles.row}>
                <div className={styles.rowBody}>
                  <span className={styles.rowTitle}>{pr.title}</span>
                  <span className={styles.rowMeta}>
                    <a
                      className={styles.link}
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {prLabel(pr.url)}
                    </a>
                    {pr.mergedAt ? (
                      <span>
                        merged {new Date(pr.mergedAt).toLocaleString()}
                      </span>
                    ) : null}
                    <PullBadge pr={pr} deploy={deploy} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};
