import { Button, Checkbox, notify } from '@notesgraph/component';
import {
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
  agentTargetKey,
  DeploymentsService,
  type ShipAction,
  shipAgents,
  type ShipStage,
  type ShipTask,
  type ShipTaskDetails,
  shipTargets,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './styles.css';

type Row = ShipTask & ShipTaskDetails;

const SECTIONS: { stage: ShipStage; title: string; hint: string }[] = [
  {
    stage: 'committed',
    title: 'Ready to merge',
    hint: 'Committed, with a pull request open',
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
 * Features ready to go out: tasks marked COMMITTED (PR open), MERGED (on
 * main) or DEPLOYED (live, unchecked), with a way to send the chosen ones to
 * a Claude Code agent on a device to merge, or merge and deploy. Shared by
 * the desktop page and the phone's, which is where it is most often used.
 */
export const DeploymentsView = () => {
  const deployments = useService(DeploymentsService);
  const agentsService = useService(AgentsService);
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;

  const tasks = useLiveData(deployments.tasks$);
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
  }, [deployments, tasks]);

  const rows = useMemo<Row[]>(
    () =>
      (tasks ?? []).flatMap(task => {
        const read = details?.get(rowKey(task));
        // Read but gone from its note, or no longer in a ship stage there.
        if (details && !read) return [];
        return [
          {
            ...task,
            stage: read?.stage ?? task.stage,
            title: read?.title ?? task.text,
            docTitle: read?.docTitle ?? '',
            pullRequest: read?.pullRequest ?? null,
          },
        ];
      }),
    [tasks, details]
  );

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
  const toMerge = shipTargets(chosen, 'merge');
  const toDeploy = shipTargets(chosen, 'deploy');

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

  const ship = useCallback(
    (action: ShipAction) => {
      if (!agent) return;
      deployments
        .ship(agent, chosen, action)
        .then(target => {
          if (!target) return;
          setSent({ agentId: agent.id, target });
          notify.success({
            title: action === 'merge' ? 'Merge sent' : 'Deploy sent',
            message: `${agent.name} on ${agent.deviceKey} is on it. Questions it asks come to you as notifications.`,
          });
        })
        .catch(err => {
          notify.error({
            title: "Couldn't send it",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [agent, chosen, deployments]
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

  const shippable = rows.some(row => row.stage !== 'deployed');

  return (
    <div className={styles.content} data-testid="deployments-view">
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
              disabled={toMerge.length === 0 || !!session?.running}
              onClick={() => ship('merge')}
              data-testid="deployments-merge"
            >
              Merge ({toMerge.length})
            </Button>
            <Button
              variant="primary"
              disabled={toDeploy.length === 0 || !!session?.running}
              onClick={() => ship('deploy')}
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

      {rows.length === 0 ? (
        <div className={styles.empty}>
          Nothing to ship. Tasks show up here when an agent marks them
          COMMITTED, MERGED or DEPLOYED.
        </div>
      ) : null}

      {SECTIONS.map(({ stage, title, hint }) => {
        const list = rows.filter(row => row.stage === stage);
        if (list.length === 0) return null;
        return (
          <section
            key={stage}
            className={styles.section}
            data-testid={`deployments-${stage}`}
          >
            <div className={styles.sectionTitle}>
              {title}
              <span className={styles.sectionCount}>{list.length}</span>
            </div>
            <div className={styles.sectionHint}>{hint}</div>
            <div className={styles.rows}>
              {list.map(row => {
                const key = rowKey(row);
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
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
