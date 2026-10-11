import { Button, Checkbox, notify } from '@notesgraph/component';
import {
  AGENT_MODES,
  AGENT_WARMUP,
  agentReadiness,
  type AgentSettings,
  FleetService,
  type InventoryDevice,
  type LogPattern,
  type MonitoringDecision,
  openDecisions,
} from '@notesgraph/core/modules/agents';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './styles.css';

const INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: 'Only when asked' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Every day' },
];

const SENSITIVITIES: { value: number; label: string }[] = [
  { value: 2, label: 'High (more alerts)' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
  { value: 5, label: 'Lowest (fewest alerts)' },
];

const ago = (seconds: number, now: number) => {
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const DecisionRow = ({
  decision,
  deviceName,
  now,
}: {
  decision: MonitoringDecision;
  deviceName: string;
  now: number;
}) => {
  const fleet = useService(FleetService);
  const [busy, setBusy] = useState(false);
  const act = useCallback(
    (what: () => Promise<void>, failure: string) => {
      setBusy(true);
      what()
        .catch(err => notify.error({ title: failure, message: errorMessage(err) }))
        .finally(() => setBusy(false));
    },
    []
  );
  const triaging = !!decision.triageJobId && !decision.triage;

  return (
    <div
      className={styles.decision}
      data-closed={decision.verdict ? true : undefined}
      data-testid="monitoring-decision"
    >
      <div className={styles.decisionHead}>
        <span
          className={styles.dot}
          data-state={decision.severity === 'critical' ? 'fail' : 'warn'}
        />
        <strong>{deviceName}</strong>
        <span className={styles.decisionSummary} title={decision.summary}>
          {decision.summary}
        </span>
        <span className={styles.pill}>
          {decision.action === 'escalated' ? 'Escalated' : 'Shadow'}
        </span>
        {decision.verdict ? (
          <span className={styles.pill}>
            {decision.verdict === 'expected' ? 'Expected' : 'Resolved'}
          </span>
        ) : null}
        <span className={styles.meta}>{ago(decision.createdAt, now)}</span>
      </div>
      {decision.triage ? <pre className={styles.triage}>{decision.triage}</pre> : null}
      {decision.verdict ? null : (
        <div className={styles.actions}>
          <Button
            onClick={() => act(() => fleet.triage(decision.id), "Couldn't start the triage")}
            disabled={busy || triaging}
            tooltip="Send a read-only Claude run to the machine to find the likely cause"
            data-testid="monitoring-decision-triage"
          >
            {triaging ? 'Triaging…' : decision.triage ? 'Triage again' : 'Triage with Claude'}
          </Button>
          <Button
            variant="plain"
            onClick={() => act(() => fleet.feedback(decision.id, 'expected'), "Couldn't save that")}
            disabled={busy}
            tooltip="This is normal for this machine: the agent learns it and won't flag it again"
            data-testid="monitoring-decision-expected"
          >
            Expected
          </Button>
          <Button
            variant="plain"
            onClick={() => act(() => fleet.feedback(decision.id, 'resolved'), "Couldn't save that")}
            disabled={busy}
            tooltip="Fixed: if it comes back, the agent flags it again straight away"
            data-testid="monitoring-decision-resolved"
          >
            Resolved
          </Button>
        </div>
      )}
    </div>
  );
};

/** Patterns shown a machine before "Show all". */
const PATTERNS_SHOWN = 15;

const PatternRow = ({ deviceKey, pattern }: { deviceKey: string; pattern: LogPattern }) => {
  const fleet = useService(FleetService);
  const [busy, setBusy] = useState(false);
  const label = useCallback(
    (next: 'known' | null) => {
      setBusy(true);
      fleet
        .labelPattern(deviceKey, pattern.id, next)
        .catch(err => notify.error({ title: "Couldn't label it", message: errorMessage(err) }))
        .finally(() => setBusy(false));
    },
    [fleet, deviceKey, pattern.id]
  );

  return (
    <div className={styles.logRow} data-testid="monitoring-log-pattern">
      <span className={styles.dot} data-state={pattern.known ? 'ok' : 'warn'} />
      <span className={styles.logTemplate} title={pattern.example}>
        {pattern.template}
      </span>
      <span className={styles.meta}>
        {pattern.count}× · ~{pattern.perHour}/h
      </span>
      {pattern.label === 'known' ? (
        <Button variant="plain" disabled={busy} onClick={() => label(null)}>
          Unmark
        </Button>
      ) : (
        <Button
          variant="plain"
          disabled={busy}
          onClick={() => label('known')}
          tooltip="Normal for this machine: never flag it as new"
        >
          Known
        </Button>
      )}
    </div>
  );
};

/** What the machines' logs normally say: the agent's catalog of patterns. */
const LogPatterns = ({ nameOf }: { nameOf: (key: string) => string }) => {
  const fleet = useService(FleetService);
  const catalogs = useLiveData(fleet.logCatalogs$);
  const [all, setAll] = useState(false);
  const total = catalogs.reduce((sum, catalog) => sum + catalog.patterns.length, 0);

  return (
    <details className={styles.logs} data-testid="monitoring-log-patterns">
      <summary className={styles.logsSummary}>
        Log patterns
        <span className={styles.meta}>
          {' · '}
          {total === 0
            ? 'none yet: the health check reads warnings and errors from the journal on Linux machines'
            : `${total} on ${catalogs.length} ${catalogs.length === 1 ? 'machine' : 'machines'}`}
        </span>
      </summary>
      {catalogs.map(catalog => (
        <div key={catalog.deviceKey} className={styles.logs}>
          <span className={styles.meta}>
            <strong>{nameOf(catalog.deviceKey)}</strong> · {catalog.scans}{' '}
            {catalog.scans === 1 ? 'scan' : 'scans'}
            {catalog.scans < AGENT_WARMUP
              ? ` (new lines count as news after ${AGENT_WARMUP})`
              : ''}
          </span>
          {(all ? catalog.patterns : catalog.patterns.slice(0, PATTERNS_SHOWN)).map(pattern => (
            <PatternRow key={pattern.id} deviceKey={catalog.deviceKey} pattern={pattern} />
          ))}
        </div>
      ))}
      {!all && catalogs.some(catalog => catalog.patterns.length > PATTERNS_SHOWN) ? (
        <Button variant="plain" onClick={() => setAll(true)}>
          Show all
        </Button>
      ) : null}
    </details>
  );
};

/**
 * The monitoring agent on the Monitoring page: its mode (training, shadow,
 * detect), how much it has learned, its settings, and what it noticed, with
 * a way to triage each finding or teach it the finding was normal.
 */
export const MonitoringAgentPanel = ({
  machines,
  now,
}: {
  machines: InventoryDevice[];
  now: number;
}) => {
  const fleet = useService(FleetService);
  const agent = useLiveData(fleet.agent$);
  const decisions = useLiveData(fleet.decisions$);
  const [busy, setBusy] = useState(false);

  const configure = useCallback(
    (settings: AgentSettings, done?: string) => {
      setBusy(true);
      fleet
        .configureAgent(settings)
        .then(() => (done ? notify.success({ title: done }) : undefined))
        .catch(err =>
          notify.error({ title: "Couldn't change the agent", message: errorMessage(err) })
        )
        .finally(() => setBusy(false));
    },
    [fleet]
  );

  const reset = useCallback(() => {
    setBusy(true);
    fleet
      .resetAgent()
      .then(() => notify.success({ title: 'The agent starts learning again' }))
      .catch(err => notify.error({ title: "Couldn't reset", message: errorMessage(err) }))
      .finally(() => setBusy(false));
  }, [fleet]);

  // A server without the agent says nothing here.
  if (!agent) return null;

  const nameOf = (key: string) => machines.find(m => m.key === key)?.name ?? key;
  const open = openDecisions(decisions);
  const { ready, seen } = agentReadiness(agent);
  const mode = AGENT_MODES.find(m => m.value === agent.mode) ?? AGENT_MODES[0];

  return (
    <section className={styles.section} data-testid="monitoring-agent">
      <div className={styles.sectionTitle}>
        Monitoring agent
        {agent.enabled ? (
          <span className={styles.sectionCount}>
            {mode.label}
            {open.length > 0 ? ` · ${open.length} open` : ''}
          </span>
        ) : null}
      </div>
      <div className={styles.card}>
        {!agent.enabled ? (
          <>
            <span className={styles.modeNote}>
              The agent learns what normal looks like on each machine from its
              health checks and its logs, flags what&apos;s new, and escalates
              only what matters. It needs no thresholds. It starts in training and tells
              nobody anything until you move it to shadow or detect.
            </span>
            <div className={styles.actions}>
              <Button
                variant="primary"
                onClick={() => configure({ mode: 'training' }, 'The monitoring agent is learning')}
                disabled={busy}
                data-testid="monitoring-agent-enable"
              >
                Turn on the agent
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.modes} role="radiogroup">
              {AGENT_MODES.map(option => (
                <button
                  key={option.value}
                  className={styles.tile}
                  role="radio"
                  aria-checked={agent.mode === option.value}
                  data-active={agent.mode === option.value || undefined}
                  disabled={busy}
                  onClick={() =>
                    agent.mode !== option.value && configure({ mode: option.value })
                  }
                  data-testid={`monitoring-agent-mode-${option.value}`}
                >
                  <span className={styles.cardName}>{option.label}</span>
                </button>
              ))}
            </div>
            <span className={styles.modeNote}>{mode.note}</span>
            <span className={styles.meta}>
              {seen === 0
                ? 'No health checks seen yet. Check the machines to start it learning.'
                : `Knows ${ready} of ${seen} ${seen === 1 ? 'machine' : 'machines'}` +
                  (ready < seen ? ` (each needs ${AGENT_WARMUP} health checks first)` : '')}
              {agent.lastRunAt ? ` · last checked them ${ago(agent.lastRunAt, now)}` : ''}
            </span>
            <div className={styles.settings}>
              <label className={styles.setting}>
                Check machines
                <select
                  className={styles.select}
                  value={agent.intervalMinutes}
                  disabled={busy}
                  onChange={e => configure({ intervalMinutes: Number(e.target.value) })}
                  data-testid="monitoring-agent-interval"
                >
                  {INTERVALS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.setting}>
                Sensitivity
                <select
                  className={styles.select}
                  value={agent.sensitivity}
                  disabled={busy}
                  onChange={e => configure({ sensitivity: Number(e.target.value) })}
                  data-testid="monitoring-agent-sensitivity"
                >
                  {SENSITIVITIES.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.setting}>
                <Checkbox
                  checked={agent.alerts.push}
                  disabled={busy}
                  onChange={() => configure({ alerts: { push: !agent.alerts.push } })}
                  data-testid="monitoring-agent-push"
                />
                Phone alerts
              </label>
              <label
                className={styles.setting}
                title="On escalation, send a read-only Claude run to the machine to find the likely cause"
              >
                <Checkbox
                  checked={agent.autoTriage}
                  disabled={busy}
                  onChange={() => configure({ autoTriage: !agent.autoTriage })}
                  data-testid="monitoring-agent-triage"
                />
                Triage with Claude
              </label>
              <Button
                variant="plain"
                onClick={reset}
                disabled={busy}
                tooltip="Forget what it learned and go back to training"
              >
                Relearn
              </Button>
            </div>
            <LogPatterns nameOf={nameOf} />
            {decisions.length > 0 ? (
              <div className={styles.decisions}>
                {decisions.map(decision => (
                  <DecisionRow
                    key={decision.id}
                    decision={decision}
                    deviceName={nameOf(decision.deviceKey)}
                    now={now}
                  />
                ))}
              </div>
            ) : agent.mode !== 'training' ? (
              <span className={styles.meta}>Nothing out of the ordinary yet.</span>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
};
