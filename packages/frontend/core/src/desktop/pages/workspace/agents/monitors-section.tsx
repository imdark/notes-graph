import { Text } from '@blocksuite/notesgraph/store';
import { Button, notify } from '@notesgraph/component';
import {
  formatTrendValue,
  isNotesHealthMonitor,
  type Monitor,
  MonitorsService,
  NOTES_HEALTH_DOC_TITLE,
  notesHealthDevice,
  notesHealthMonitorDraft,
  RemoteAgentRunnerService,
  sparklinePath,
  type Trend,
  WEEK_MINUTES,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { cssVar } from '@toeverything/theme';
import { useCallback, useEffect, useState } from 'react';

import { relativeTime } from '../detail-page/tabs/agent-run-row';
import * as styles from './agents-page.css';

const host = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : 'a website';
  } catch {
    return url ?? 'a website';
  }
};

const every = (minutes: number) =>
  minutes < 60
    ? `every ${minutes}m`
    : minutes < 1440
      ? `every ${minutes / 60}h`
      : minutes < WEEK_MINUTES
        ? 'daily'
        : 'weekly';

/** What it watches and how often, in a few words. */
export const watches = (monitor: Monitor) =>
  [
    monitor.kind === 'agent'
      ? `Agent on ${monitor.deviceKey ?? 'a device'}`
      : monitor.source === 'command'
        ? `Command on ${monitor.deviceKey ?? 'a device'}`
        : host(monitor.spec.url),
    every(monitor.intervalMinutes),
  ].join(' · ');

const TREND_WIDTH = 180;
const TREND_HEIGHT = 32;

/** Its numeric readings over time, with the range they span. */
const MonitorTrend = ({ monitor }: { monitor: Monitor }) => {
  const monitorsService = useService(MonitorsService);
  const [trend, setTrend] = useState<Trend | null>(null);

  useEffect(() => {
    let live = true;
    monitorsService
      .trend(monitor)
      .then(next => live && setTrend(next))
      .catch(() => {});
    return () => {
      live = false;
    };
    // The list refreshes every minute; trend() only refetches on a new reading.
  }, [monitorsService, monitor]);

  if (!trend) return null;
  return (
    <span
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}
      title={`${trend.points.length} readings, ${formatTrendValue(trend.min)} to ${formatTrendValue(trend.max)}`}
      data-testid="agents-page-monitor-trend"
    >
      <svg
        width={TREND_WIDTH}
        height={TREND_HEIGHT}
        viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
        style={{ color: cssVar('primaryColor'), flexShrink: 0 }}
        aria-hidden="true"
      >
        <path
          d={sparklinePath(trend, TREND_WIDTH, TREND_HEIGHT, 2)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className={styles.agentCardMeta}>
        {formatTrendValue(trend.min)}–{formatTrendValue(trend.max)}
      </span>
    </span>
  );
};

const MonitorCard = ({ monitor, now }: { monitor: Monitor; now: number }) => {
  const monitorsService = useService(MonitorsService);
  const dialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;

  const act = useCallback(
    async (run: () => Promise<unknown>, done?: string) => {
      try {
        await run();
        if (done) notify.success({ title: done });
      } catch (err) {
        notify.error({ title: 'Monitor', message: err instanceof Error ? err.message : String(err) });
      }
    },
    []
  );
  const edit = useCallback(() => {
    dialogService.open('monitor-editor', {
      docId: monitor.docId,
      blockId: monitor.blockId,
      monitorId: monitor.id,
    });
  }, [dialogService, monitor]);
  const openBlock = useCallback(() => {
    workbench.openDoc(
      { docId: monitor.docId, mode: 'page', blockIds: [monitor.blockId] },
      { at: 'active' }
    );
  }, [monitor, workbench]);

  return (
    <div className={styles.agentCard} data-disabled={!monitor.enabled || undefined} data-testid="agents-page-monitor">
      <span className={styles.agentCardHead}>
        <span className={styles.agentCardIcon}>📡</span>
        <span className={styles.agentCardName}>{monitor.name}</span>
        {!monitor.enabled ? <span className={styles.pill}>Paused</span> : null}
        {monitor.enabled && monitor.lastError ? <span className={styles.pill}>Failing</span> : null}
        {monitor.pending ? <span className={styles.pill}>Running</span> : null}
      </span>
      <span className={styles.agentCardMeta}>{watches(monitor)}</span>
      <span className={styles.agentCardFoot} title={monitor.lastError ?? undefined}>
        {monitor.lastError
          ? `✗ ${monitor.lastError}`
          : monitor.lastValue
            ? `${monitor.lastValue} · ${monitor.lastRunAt ? relativeTime(monitor.lastRunAt * 1000, now) : ''}`
            : 'No reading yet'}
      </span>
      <MonitorTrend monitor={monitor} />
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <Button onClick={() => void act(() => monitorsService.runNow(monitor.id), 'Checking now')}>
          Run now
        </Button>
        <Button
         
          onClick={() =>
            void act(() => monitorsService.update(monitor.id, { enabled: !monitor.enabled }))
          }
        >
          {monitor.enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button onClick={edit}>
          Edit
        </Button>
        <Button variant="plain" onClick={openBlock}>
          Open
        </Button>
      </span>
    </div>
  );
};

/**
 * Set up the weekly notes health check in one click: a "Notes health" note
 * whose first block carries the latest summary, and the weekly agent monitor
 * on it. Each run writes its report as a note linked from that one.
 */
const NotesHealthSetup = () => {
  const monitorsService = useService(MonitorsService);
  const docsService = useService(DocsService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const workbench = useService(WorkbenchService).workbench;
  const [busy, setBusy] = useState(false);

  const setUp = useCallback(async () => {
    setBusy(true);
    try {
      // Find somewhere to run it before making a note that would go unused.
      const deviceKey = notesHealthDevice(await remoteRunner.agentTargets(workspaceId));
      if (!deviceKey) throw new Error('No device or cloud runner takes agent work here.');

      const record = docsService.createDoc({ title: NOTES_HEALTH_DOC_TITLE });
      const { doc, release } = docsService.open(record.id);
      let blockId: string;
      try {
        await doc.waitForSyncReady();
        const [note] = doc.blockSuiteDoc.getBlocksByFlavour('notesgraph:note');
        if (!note) throw new Error("Couldn't write the new note.");
        blockId = doc.blockSuiteDoc.addBlock(
          'notesgraph:paragraph' as never,
          { text: new Text('Weekly notes health check: the first report is on its way.') },
          note.id
        );
      } finally {
        release();
      }

      await monitorsService.create(notesHealthMonitorDraft(record.id, blockId, deviceKey));
      notify.success({
        title: 'Notes health check set up',
        message: 'It runs now and then every week. Fixes come as to-dos in its report.',
      });
      workbench.openDoc({ docId: record.id, mode: 'page', blockIds: [blockId] }, { at: 'active' });
    } catch (err) {
      notify.error({
        title: "Couldn't set up the notes health check",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [docsService, monitorsService, remoteRunner, workbench, workspaceId]);

  return (
    <Button
      onClick={() => void setUp()}
      disabled={busy}
      title="A weekly agent run that reports orphans, broken links, duplicates, stale facts, contradictions and stubs"
      data-testid="agents-page-notes-health-setup"
    >
      Weekly notes health check
    </Button>
  );
};

/** The person's monitors, with their latest readings. */
export const MonitorsSection = ({ now }: { now: number }) => {
  const monitorsService = useService(MonitorsService);
  const monitors = useLiveData(monitorsService.monitors$);
  const error = useLiveData(monitorsService.error$);

  useEffect(() => monitorsService.watch(), [monitorsService]);

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>
        Monitors
        <span className={styles.sectionCount}>{monitors.length}</span>
        {!error && !monitors.some(isNotesHealthMonitor) ? (
          <span className={styles.sectionActions}>
            <NotesHealthSetup />
          </span>
        ) : null}
      </div>
      {monitors.length === 0 ? (
        <div className={styles.empty}>
          {error && monitors.length === 0
            ? `Monitors aren't available here: ${error}`
            : 'Nothing monitored yet. In a note, type / on a block and pick "Monitor this block…" to keep it up to date from a website, a command or an agent.'}
        </div>
      ) : (
        <div className={styles.agentGrid}>
          {[...monitors]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(monitor => (
              <MonitorCard key={monitor.id} monitor={monitor} now={now} />
            ))}
        </div>
      )}
    </section>
  );
};
