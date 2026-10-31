import { PlusIcon } from '@blocksuite/icons/rc';
import { Button, notify, Scrollable } from '@notesgraph/component';
import { saveAnswerAsDoc } from '@notesgraph/core/blocksuite/ai/utils/save-answer-as-doc';
import {
  type Agent,
  AgentContextService,
  AgentIcon,
  type AgentRunSession,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
  agentTargetBlockIds,
  COMPILE_SOURCE_TEMPLATE,
  compileBrief,
  compileSourceOf,
  findCompileAgent,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocService } from '@notesgraph/core/modules/doc';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AgentQuestionCard } from './agent-question';
import { AgentReviewCard } from './agent-review-card';
import { AgentRunLogDialog, type RunLogTab } from './agent-run-log';
import { RunRow, RunStatusBadge, useMinuteTick } from './agent-run-row';
import * as styles from './agents.css';
import { useRunActions } from './use-run-actions';

/** Recent runs shown here; the Agents page has the rest. */
const PANEL_RUNS = 8;

/** A run's output, cut at six lines until Show more opens the rest. */
const ClampedOutput = ({ text }: { text: string }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <>
      <p
        ref={ref}
        className={styles.output}
        data-clamped={!expanded}
        data-testid="agent-output"
      >
        {text}
      </p>
      {clamped || expanded ? (
        <button
          className={styles.outputMore}
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          data-testid="agent-output-more"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </>
  );
};

/** One run going, or finished and not yet dismissed. */
export const SessionCard = ({
  session,
  queued,
  onViewLog,
  onAsk,
  onShowTarget,
}: {
  session: AgentRunSession;
  /** How many on-device runs wait for this one, when it is on-device. */
  queued: number;
  onViewLog: (runId: string) => void;
  /** Open a chat about the run once it has ended (see AgentRunChat). */
  onAsk?: (runId: string) => void;
  onShowTarget: (target: AgentRunSession['target']) => void;
}) => {
  const sessionService = useService(AgentRunSessionService);
  const agentsService = useService(AgentsService);
  const { running } = session;

  // Start the same agent on the same target afresh, stopping this run first
  // when it is still going; the old card makes way for the new run's.
  const [restarting, setRestarting] = useState(false);
  const restart = useCallback(() => {
    const agent = agentsService.agents$.value.find(
      ({ id }) => id === session.agentId
    );
    if (!agent) {
      notify.error({
        title: "Can't restart it",
        message: `${session.agentName} has been deleted.`,
      });
      return;
    }
    setRestarting(true);
    (session.running ? sessionService.stop(session.id) : Promise.resolve())
      .then(() => {
        sessionService.dismiss(session.id);
        return sessionService.start(agent, session.target);
      })
      .catch(err =>
        notify.error({
          title: "Couldn't restart it",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setRestarting(false));
  }, [agentsService, session, sessionService]);
  // A worker's result is the note it changed; what it says at the end is a
  // report on that, so there's no answer to copy.
  const answers = session.agentKind === 'answer';

  const copyOutput = useCallback(() => {
    if (!session.output) return;
    navigator.clipboard
      .writeText(session.output)
      .then(() => notify.success({ title: 'Copied' }))
      .catch(() => notify.error({ title: "Couldn't copy" }));
  }, [session.output]);

  const workspace = useService(WorkspaceService).workspace;
  const workbench = useService(WorkbenchService).workbench;
  const [saving, setSaving] = useState(false);
  // Keep the answer as a note of its own, linked back to the note (or block)
  // it was asked on and to what it cites, so it joins the notes graph.
  const saveOutput = useCallback(() => {
    if (!session.output) return;
    const { target } = session;
    setSaving(true);
    saveAnswerAsDoc(workspace.docCollection, session.output, {
      sources: [
        { docId: target.docId, blockId: agentTargetBlockIds(target)[0] },
      ],
    })
      .then(docId => {
        if (!docId) throw new Error('No doc was created');
        notify.success({
          title: 'Saved as a note',
          actions: [
            {
              key: 'open',
              label: 'Open',
              onClick: () => workbench.openDoc(docId),
            },
          ],
        });
      })
      .catch(err => {
        console.error(err);
        notify.error({ title: "Couldn't save the answer" });
      })
      .finally(() => setSaving(false));
  }, [session, workspace, workbench]);

  const status = running
    ? session.questions.length > 0
      ? 'waiting'
      : 'running'
    : session.error
      ? 'error'
      : 'done';

  return (
    <div className={styles.section} data-testid="agent-session">
      <div className={styles.panelFooter}>
        <span className={styles.sectionLabel} title={session.agentName}>
          {session.targetLabel}
        </span>
        <span className={styles.sessionHeadSide}>
          {session.focus || agentTargetBlockIds(session.target).length > 0 ? (
            <button
              className={styles.linkButton}
              // Working down a list, the agent moves from block to block, so
              // go to the one it is on (or last touched), else the run's own.
              onClick={() =>
                onShowTarget(
                  session.focus
                    ? {
                        kind: 'block',
                        docId: session.focus.docId,
                        blockId: session.focus.blockId,
                      }
                    : session.target
                )
              }
              title={
                running
                  ? 'Go to the block the agent is working on'
                  : 'Go to the last block the agent worked on'
              }
              data-testid="agent-show-target"
            >
              Show
            </button>
          ) : null}
          <RunStatusBadge status={status} />
        </span>
      </div>

      {session.remoteJobId
        ? session.questions.map(question => (
            <AgentQuestionCard
              key={question.id}
              jobId={session.remoteJobId as string}
              question={question}
            />
          ))
        : null}

      {session.error ? (
        <p className={styles.error} data-testid="agent-error">
          {session.error}
        </p>
      ) : session.output ? (
        <ClampedOutput text={session.output} />
      ) : (
        <p className={styles.empty}>
          {!running
            ? answers
              ? 'It finished without an answer. The log shows what it did.'
              : 'It finished. The log shows what it did.'
            : session.questions.length > 0
              ? 'Waiting for you…'
              : 'Working…'}
        </p>
      )}

      <div className={styles.sessionActions}>
        {running ? (
          <Button
            onClick={() => sessionService.cancel(session.id)}
            data-testid="cancel-agent"
            title={
              queued > 0
                ? 'Stop this run; the next queued one starts'
                : undefined
            }
          >
            Stop
          </Button>
        ) : (
          <>
            {answers && session.output ? (
              <Button
                variant="primary"
                onClick={copyOutput}
                data-testid="copy-agent-output"
              >
                Copy answer
              </Button>
            ) : null}
            {answers && session.output ? (
              <Button
                onClick={saveOutput}
                loading={saving}
                disabled={saving}
                title="Save the answer as a new note, linked to this one and to what it cites"
                data-testid="save-agent-output"
              >
                Save as note
              </Button>
            ) : null}
          </>
        )}
        <Button
          onClick={restart}
          loading={restarting}
          disabled={restarting}
          tooltip={
            running
              ? 'Stop this run and start it again from the beginning'
              : 'Run it again on the same target'
          }
          data-testid="restart-agent"
        >
          Restart
        </Button>
        <Button
          onClick={() => sessionService.dismiss(session.id)}
          tooltip={
            running
              ? 'Stop this run and take it off the panel'
              : 'Take it off the panel; it stays in the run history'
          }
          data-testid="remove-agent-session"
        >
          Remove
        </Button>
        {session.runId ? (
          <Button
            variant="plain"
            onClick={() => onViewLog(session.runId as string)}
            data-testid="view-agent-log"
          >
            View log
          </Button>
        ) : null}
        {!running && session.runId && onAsk ? (
          <Button
            variant="plain"
            onClick={() => onAsk(session.runId as string)}
            title="Ask what it did, why it stopped, or what is left"
            data-testid="ask-agent-run"
          >
            Ask about it
          </Button>
        ) : null}
      </div>

      {!running && answers && session.output ? (
        <span className={styles.hint}>
          Nothing is written to the note — copy it, or save it as a note of its
          own.
        </span>
      ) : null}
      {!running && !answers ? (
        <span className={styles.hint}>
          It works in the note itself — its changes are already there.
        </span>
      ) : null}
    </div>
  );
};

export const EditorAgentsPanel = () => {
  const agentsService = useService(AgentsService);
  const sessionService = useService(AgentRunSessionService);
  const runsStore = useService(AgentRunsStore);
  const dialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;
  const doc = useService(DocService).doc;
  const now = useMinuteTick();

  const docAgents = useLiveData(agentsService.agentsFor$('doc'));
  const allAgents = useLiveData(agentsService.agents$);
  const sessions = useLiveData(sessionService.sessions$);
  const queue = useLiveData(sessionService.queue$);
  const runs = useLiveData(
    useMemo(() => runsStore.watchRunsForDoc(doc.id), [runsStore, doc.id])
  );
  const toReview = useMemo(() => runs.filter(run => run.reviewPending), [runs]);

  const runOnDoc = useCallback(
    (agent: Agent) => {
      sessionService
        .start(agent, { kind: 'doc', docId: doc.id })
        .catch(console.error);
    },
    [doc.id, sessionService]
  );

  // A clipped or imported note offers to be compiled into the rest of the
  // notes. The agent is made from its template the first time, so the button
  // works before anyone has set one up.
  const contextService = useService(AgentContextService);
  const properties = useLiveData(doc.properties$);
  const source = useMemo(() => compileSourceOf(properties), [properties]);
  const compileAgent = findCompileAgent(
    allAgents,
    COMPILE_SOURCE_TEMPLATE.draft.instructions
  );
  const compiling = sessions.some(
    session =>
      session.running &&
      session.agentId === compileAgent?.id &&
      session.target.docId === doc.id
  );
  const compileIntoNotes = useCallback(() => {
    if (!source) return;
    const agent =
      compileAgent ??
      agentsService.create('personal', COMPILE_SOURCE_TEMPLATE.draft);
    const target = { kind: 'doc', docId: doc.id } as const;
    contextService
      .build(target)
      .then(context =>
        sessionService.start(
          agent,
          target,
          compileBrief(context, doc.id, source)
        )
      )
      .catch(err =>
        notify.error({
          title: "Couldn't start compiling",
          message: err instanceof Error ? err.message : String(err),
        })
      );
  }, [
    agentsService,
    compileAgent,
    contextService,
    doc.id,
    sessionService,
    source,
  ]);

  const runningCount = sessions.filter(session => session.running).length;
  const onDeviceBusy = sessions.some(
    session => session.running && session.onDevice
  );
  const runActions = useRunActions({ openDoc: false });
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const [logTab, setLogTab] = useState<RunLogTab | undefined>();
  const openLog = useCallback((runId: string) => {
    setLogTab(undefined);
    setLogRunId(runId);
  }, []);
  const askAbout = useCallback((runId: string) => {
    setLogTab('ask');
    setLogRunId(runId);
  }, []);
  // "Review changes" opens on what the run changed.
  const openChanges = useCallback((runId: string) => {
    setLogTab('changes');
    setLogRunId(runId);
  }, []);
  const closeLog = useCallback(() => setLogRunId(null), []);

  // The panel is where someone realises they want an agent, so it has to be
  // able to get them there rather than naming a screen they have to go find.
  const openAgentSettings = useCallback(() => {
    dialogService.open('setting', { activeTab: 'workspace:agents' });
  }, [dialogService]);
  const openAgentsPage = useCallback(() => {
    workbench.open('/agents');
  }, [workbench]);

  return (
    <Scrollable.Root className={styles.root}>
      <Scrollable.Viewport>
        <div className={styles.body}>
          {toReview.length > 0 ? (
            <div className={styles.section} data-testid="agent-review-list">
              <span className={styles.sectionLabel}>
                Needs you ({toReview.length})
              </span>
              {toReview.map(run => (
                <AgentReviewCard
                  key={run.id}
                  run={run}
                  onReview={openChanges}
                  onAsk={askAbout}
                />
              ))}
            </div>
          ) : null}

          {source ? (
            <div className={styles.section} data-testid="compile-source">
              <span className={styles.sectionLabel}>
                {source.kind === 'readwise'
                  ? 'Imported from Readwise'
                  : 'Clipped from the web'}
              </span>
              <Button
                variant="primary"
                onClick={compileIntoNotes}
                disabled={compiling}
                data-testid="compile-into-notes"
              >
                {compiling ? 'Compiling…' : 'Compile into my notes'}
              </Button>
              <span className={styles.hint}>
                An agent writes a summary note linked to this one, adds what it
                says to your notes on the same people and ideas with a citation
                back here, and creates notes for new concepts. Anything that
                contradicts what you have is flagged, not overwritten.
              </span>
            </div>
          ) : null}

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Run on this note</span>
            {docAgents.length === 0 ? (
              <p className={styles.empty}>
                {allAgents.length === 0
                  ? 'You have no agents yet. An agent is a saved instruction — "summarise this", "find open questions" — that you can run on a note.'
                  : 'None of your agents run on a whole note. Turn on "note" for one in its settings, or run one on a block from the editor.'}
              </p>
            ) : (
              <div className={styles.agentList}>
                {docAgents.map(agent => (
                  <button
                    key={agent.id}
                    className={styles.agentButton}
                    onClick={() => runOnDoc(agent)}
                    data-testid="run-agent"
                    title={
                      onDeviceBusy && sessionService.queues(agent)
                        ? `Queue ${agent.name} after the on-device run going`
                        : `Run ${agent.name}`
                    }
                  >
                    <span className={styles.agentEmoji}>
                      <AgentIcon agent={agent} />
                    </span>
                    <span className={styles.agentName}>{agent.name}</span>
                    {sessions.some(
                      session => session.running && session.agentId === agent.id
                    ) ? (
                      <RunStatusBadge status="running" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
            <Button
              variant={allAgents.length === 0 ? 'primary' : 'secondary'}
              onClick={openAgentSettings}
              data-testid="panel-new-agent"
              prefix={<PlusIcon />}
            >
              New agent
            </Button>
            <span className={styles.hint}>
              To run one on a block or a selection, press <code>Ctrl/⌘ K</code>{' '}
              (or type <code>/</code>) in the editor and pick it there.
            </span>
          </div>

          {runningCount > 1 || (runningCount > 0 && queue.length > 0) ? (
            <div className={styles.sessionActions}>
              <span className={styles.hint}>{runningCount} running</span>
              <Button
                onClick={() => sessionService.cancelAll()}
                data-testid="cancel-all-agents"
              >
                Stop all
              </Button>
            </div>
          ) : null}

          {sessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              queued={session.onDevice ? queue.length : 0}
              onViewLog={openLog}
              onAsk={askAbout}
              onShowTarget={runActions.showTarget}
            />
          ))}

          {queue.length > 0 ? (
            <div className={styles.section} data-testid="agent-queue">
              <span className={styles.sectionLabel}>
                Up next on this device ({queue.length})
              </span>
              <div className={styles.runList}>
                {queue.map(run => (
                  <div
                    key={run.id}
                    className={styles.panelFooter}
                    data-testid="agent-queue-item"
                  >
                    <span>
                      {run.agent.emoji ? `${run.agent.emoji} ` : ''}
                      {run.agent.name} · {run.targetLabel}
                    </span>
                    <button
                      className={styles.linkButton}
                      onClick={() => sessionService.dequeue(run.id)}
                      data-testid="agent-queue-remove"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.section}>
            <div className={styles.panelFooter}>
              <span className={styles.sectionLabel}>Recent runs here</span>
              <button
                className={styles.linkButton}
                onClick={openAgentsPage}
                data-testid="open-agents-page"
              >
                All runs →
              </button>
            </div>
            {runs.length === 0 ? (
              <p className={styles.empty}>No agent has run on this note yet.</p>
            ) : (
              <div className={styles.runList}>
                {runs.slice(0, PANEL_RUNS).map(run => (
                  <RunRow
                    key={run.id}
                    run={run}
                    now={now}
                    onOpen={openLog}
                    onShowTarget={runActions.showRunTarget}
                    onRetry={runActions.retry}
                    onDelete={runActions.remove}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Scrollable.Viewport>
      <Scrollable.Scrollbar />
      <AgentRunLogDialog
        runId={logRunId}
        initialTab={logTab}
        onClose={closeLog}
      />
    </Scrollable.Root>
  );
};
