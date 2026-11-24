import { Button, notify } from '@notesgraph/component';
import {
  type AgentRun,
  fixKey,
  FixTaskService,
  type HealthFailure,
} from '@notesgraph/core/modules/agents';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

/** The newest log lines handed to the fixing agent, each clipped. */
const LOG_LINES = 40;
const LINE_CHARS = 300;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * A run as a failure for the Fix it agent: its metadata, what it read, its
 * answer and the end of its log, so the agent can reevaluate what happened.
 */
export const runFailure = (
  run: AgentRun,
  log: string,
  summary: string | null
): HealthFailure => {
  const name = run.title || run.agentName;
  const tail = log
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .slice(-LOG_LINES)
    .map(line => clip(line, LINE_CHARS));
  return {
    title: `Review run "${name}" (${run.status}, started ${new Date(run.startedAt).toLocaleString()})`,
    details: [
      `Run ${run.id} of the agent "${run.agentName}", status ${run.status}${run.steps ? `, ${run.steps} steps` : ''}.`,
      [
        run.deviceKey ? `Device: ${run.deviceKey}` : null,
        run.harness ? `Harness: ${run.harness}` : null,
        run.model ? `Model: ${run.model}` : null,
        run.folder ? `Folder: ${run.folder}` : null,
      ]
        .filter(Boolean)
        .join('. '),
      ...(run.error ? [`Error: ${clip(run.error, 600)}`] : []),
      ...(run.input ? [`It read: ${clip(run.input, 600)}`] : []),
      ...(summary ? [`Its answer: ${clip(summary, 1000)}`] : []),
      ...(tail.length ? ['End of its log:', ...tail] : ['It left no log.']),
      'Reevaluate what this run did, find what went wrong or was missed and fix it.',
    ].filter(Boolean),
    sourceDocId: run.docId || undefined,
    deviceKey: run.deviceKey,
  };
};

/**
 * "Fix it" inside a run's log: hands the run's log and metadata to the Fix it
 * agent. The new run opens through `onOpenRun`.
 */
export const AgentRunFix = ({
  run,
  log,
  summary,
  onOpenRun,
}: {
  run: AgentRun;
  log: string;
  summary: string | null;
  onOpenRun: (runId: string) => void;
}) => {
  const fixTask = useService(FixTaskService);
  const [busy, setBusy] = useState(false);
  const failure = useMemo(
    () => runFailure(run, log, summary),
    [run, log, summary]
  );
  const key = fixKey(failure);
  const started = useLiveData(
    useMemo(() => fixTask.watchFix(key), [fixTask, key])
  );

  const fix = useCallback(() => {
    setBusy(true);
    fixTask
      .fix(failure)
      .then(({ runId }) => {
        if (runId) {
          onOpenRun(runId);
          return;
        }
        notify.success({
          title: 'An agent is on it',
          message: `"${failure.title}" is a to-do in Fix-ups. The Agents page shows the run.`,
        });
      })
      .catch(err =>
        notify.error({
          title: "Couldn't start the fix",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setBusy(false));
  }, [failure, fixTask, onOpenRun]);

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <Button
        onClick={fix}
        loading={busy}
        disabled={busy}
        tooltip="Hand this run's log and details to the Fix it agent to reevaluate and fix what went wrong. It asks before anything risky."
        data-testid="agent-run-log-fix-it"
      >
        Fix it
      </Button>
      {started?.runId ? (
        <Button
          onClick={() => onOpenRun(started.runId as string)}
          data-testid="agent-run-log-fix-show"
        >
          Show agent
        </Button>
      ) : null}
    </span>
  );
};
