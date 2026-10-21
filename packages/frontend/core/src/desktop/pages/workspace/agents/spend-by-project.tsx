import {
  formatRunCost,
  projectFromProps,
  RemoteAgentRunnerService,
  spendByProject,
  type SpentRun,
  weekStarts,
} from '@notesgraph/core/modules/agents';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './agents-page.css';

/** Weeks the table covers, this one included. */
const WEEKS = 4;

const weekLabel = (start: number, isCurrent: boolean) =>
  isCurrent
    ? 'This week'
    : new Date(start).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });

const cost = (usd: number) => (usd > 0 ? formatRunCost(usd) : '–');

const agentTime = (ms: number) => {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
};

const tokenCount = new Intl.NumberFormat(undefined, { notation: 'compact' });

/**
 * What device and cloud runs cost per project over the last few weeks. A run
 * belongs to the project in the `#project:` prop of the note it ran on.
 *
 * `refreshKey` changes when runs end, which is when the numbers move.
 */
export const SpendByProject = ({ refreshKey }: { refreshKey: number }) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const docsSearch = useService(DocsSearchService);
  const workspaceId = useService(WorkspaceService).workspace?.id;
  const [runs, setRuns] = useState<SpentRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [props, setProps] = useState<Map<string, string[]>>(new Map());

  const weeks = useMemo(() => weekStarts(WEEKS), []);

  useEffect(() => {
    if (!workspaceId || !remoteRunner.hasServer) return;
    let cancelled = false;
    remoteRunner
      .spend(workspaceId, WEEKS * 7)
      .then(next => {
        if (cancelled) return;
        setRuns(next);
        setLoadError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, remoteRunner, workspaceId]);

  const docIds = useMemo(
    () => [...new Set((runs ?? []).flatMap(run => run.docId ?? []))].sort(),
    [runs]
  );
  const docKey = docIds.join(',');
  useEffect(() => {
    // Keyed on the ids rather than the array, so a refresh that brings the
    // same notes doesn't search the index again.
    const sub = docsSearch
      .docProps$(docKey ? docKey.split(',') : [])
      .subscribe({ next: setProps, error: () => setProps(new Map()) });
    return () => sub.unsubscribe();
  }, [docKey, docsSearch]);

  const rows = useMemo(
    () =>
      spendByProject(
        runs ?? [],
        docId => (docId ? projectFromProps(props.get(docId) ?? []) : null),
        weeks
      ),
    [props, runs, weeks]
  );

  // A local workspace has no server, so no runs report what they cost.
  if (!workspaceId || !remoteRunner.hasServer) return null;

  let body;
  if (loadError && !runs) {
    body = (
      <div className={styles.empty}>
        Couldn&apos;t load what runs cost: {loadError}. It reloads when a run
        ends.
      </div>
    );
  } else if (!runs) {
    body = <div className={styles.budget}>Loading what runs cost…</div>;
  } else if (rows.length === 0) {
    body = (
      <div className={styles.empty}>
        No device or cloud runs ended in the last {WEEKS} weeks. Run an agent on
        a device or in the cloud and its cost shows up here.
      </div>
    );
  } else {
    body = (
      <>
        <div className={styles.spendScroll}>
          <table className={styles.spendTable} data-testid="agents-page-spend">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Cost</th>
                {weeks.map((start, i) => (
                  <th key={start} scope="col" className={styles.spendWeek}>
                    {weekLabel(start, i === weeks.length - 1)}
                  </th>
                ))}
                <th scope="col">Runs</th>
                <th scope="col">Failed</th>
                <th scope="col">Agent time</th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.project ?? ''}>
                  <th scope="row">
                    {row.project ?? (
                      <span className={styles.spendNone}>No project</span>
                    )}
                  </th>
                  <td>{cost(row.costUsd)}</td>
                  {row.weekCostUsd.map((usd, i) => (
                    <td key={weeks[i]} className={styles.spendWeek}>
                      {cost(usd)}
                    </td>
                  ))}
                  <td>{row.runs}</td>
                  <td className={row.failed ? styles.budgetOver : undefined}>
                    {row.failed || '–'}
                  </td>
                  <td>{agentTime(row.durationMs)}</td>
                  <td>{row.tokens ? tokenCount.format(row.tokens) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.spendNote}>
          Device and cloud runs only; runs in this app don&apos;t report a cost.
          A run counts toward the <code>#project:</code> prop of the note it ran
          on.
        </div>
      </>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>
        Spend by project, last {WEEKS} weeks
      </div>
      {body}
    </section>
  );
};
