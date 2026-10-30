import {
  Button,
  Checkbox,
  Input,
  Modal,
  notify,
  Scrollable,
} from '@notesgraph/component';
import {
  type Agent,
  AgentsService,
  CLAUDE_CODE_MODEL,
  type ConditionType,
  type ExtractType,
  isDeviceClaudeModel,
  MIN_INTERVAL_MINUTES,
  type MonitorDraft,
  type MonitorKind,
  MonitorsService,
  RemoteAgentRunnerService,
  RESEARCH_MODEL,
  WEEK_MINUTES,
} from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './setting/workspace-setting/agents/styles.css';

/** What a monitor watches, as the editor offers it. */
type What = 'url' | 'command' | 'agent';

const WHAT: { value: What; label: string; note: string }[] = [
  { value: 'url', label: 'A website or API', note: 'Fetched by the server' },
  {
    value: 'command',
    label: 'A command on a device',
    note: 'Shell, or a DB via psql/sqlite3',
  },
  {
    value: 'agent',
    label: 'An agent',
    note: 'Searches and rewrites the block itself',
  },
];

/** What an agent monitor runs as on its device. */
const RUN_WITH: { value: string; label: string; hint: string }[] = [
  {
    value: CLAUDE_CODE_MODEL,
    label: 'Claude Code',
    hint: 'Searches the web and your notes.',
  },
  {
    value: RESEARCH_MODEL,
    label: 'Research (OmniSeek)',
    hint: 'Claude Code with OmniSeek: sources in other languages, papers, PDFs and video. The device needs OmniSeek running.',
  },
];

/**
 * The model and tools a monitor started from this agent runs with. A
 * research agent runs as Claude Code with OmniSeek on the device; its in-tab
 * research tools are named for the browser loop, so none are carried over.
 */
const runAs = (agent: Agent) =>
  agent.harness === 'research'
    ? { model: RESEARCH_MODEL, tools: [] }
    : { model: agent.model ?? CLAUDE_CODE_MODEL, tools: agent.tools };

const EXTRACTORS: { value: ExtractType; label: string; hint: string }[] = [
  {
    value: 'number',
    label: 'A number',
    hint: 'The price on a shop page, or the first number',
  },
  {
    value: 'jsonpath',
    label: 'JSON path',
    hint: 'e.g. rates.EUR or data[0].price',
  },
  {
    value: 'regex',
    label: 'Regex',
    hint: 'The first capture group, e.g. fixed\\s+([\\d.]+)%',
  },
  { value: 'text', label: 'Text', hint: 'The whole output, trimmed' },
];

const CONDITIONS: { value: ConditionType; label: string }[] = [
  { value: 'change', label: 'When it changes' },
  { value: 'below', label: 'When it drops below…' },
  { value: 'above', label: 'When it rises above…' },
  { value: 'always', label: 'Every reading' },
];

const INTERVALS = [5, 15, 30, 60, 180, 360, 720, 1440, WEEK_MINUTES];

const SEARCH_ENGINES =
  /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|search\.brave)\.[a-z.]+$/i;

/**
 * A search engine's own page: fetching it reads its home page, it doesn't
 * search, so a question monitored there gets the footer's year or nothing.
 */
const isSearchEngine = (url: string) => {
  try {
    return SEARCH_ENGINES.test(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
};

const intervalLabel = (minutes: number) =>
  minutes < 60
    ? `Every ${minutes} minutes`
    : minutes === 60
      ? 'Every hour'
      : minutes < 1440
        ? `Every ${minutes / 60} hours`
        : minutes < WEEK_MINUTES
          ? 'Every day'
          : 'Every week';

/**
 * Make or change the monitor on a block. Opened from "Monitor this block…"
 * in the editor's menus, from the block's monitor chip, and from the Agents
 * page.
 */
export const MonitorEditorDialog = ({
  close,
  docId,
  blockId,
  text,
  monitorId,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['monitor-editor']>) => {
  const monitorsService = useService(MonitorsService);
  const agentsService = useService(AgentsService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const monitors = useLiveData(monitorsService.monitors$);
  const runEnabled = useLiveData(
    useService(FeatureFlagService).flags.enable_monitor_run_button.$
  );
  const existing = useMemo(
    () => monitors.find(m => m.id === monitorId),
    [monitorId, monitors]
  );
  const allAgents = useLiveData(agentsService.agents$);
  // Only device Claude agents can run unattended on a schedule; a research
  // agent can too, as Claude Code with OmniSeek (see runAs).
  const deviceAgents = useMemo(
    () =>
      allAgents.filter(
        (a: Agent) =>
          a.harness === 'research' ||
          (a.harness === 'remote' && isDeviceClaudeModel(a.model))
      ),
    [allAgents]
  );

  const [name, setName] = useState(
    existing?.name ?? (text?.trim().slice(0, 60) || 'Monitor')
  );
  const [what, setWhat] = useState<What>(
    existing
      ? existing.kind === 'agent'
        ? 'agent'
        : (existing.source ?? 'url')
      : 'url'
  );
  const [url, setUrl] = useState(existing?.spec.url ?? '');
  const [command, setCommand] = useState(existing?.spec.command ?? '');
  const [extractType, setExtractType] = useState<ExtractType>(
    existing?.spec.extract?.type ?? 'number'
  );
  const [pattern, setPattern] = useState(existing?.spec.extract?.pattern ?? '');
  const [agentId, setAgentId] = useState<string>('');
  const [instructions, setInstructions] = useState(
    existing?.spec.instructions ?? ''
  );
  const [model, setModel] = useState(existing?.spec.model ?? CLAUDE_CODE_MODEL);
  const [deviceKey, setDeviceKey] = useState(existing?.deviceKey ?? '');
  const [interval, setInterval] = useState(existing?.intervalMinutes ?? 60);
  const [conditionType, setConditionType] = useState<ConditionType>(
    existing?.condition.type ?? 'change'
  );
  const [conditionValue, setConditionValue] = useState(
    existing?.condition.value !== undefined
      ? String(existing.condition.value)
      : ''
  );
  const [alerts, setAlerts] = useState({
    inApp: existing?.alerts.inApp ?? true,
    push: existing?.alerts.push ?? false,
    email: existing?.alerts.email ?? false,
  });
  const [devices, setDevices] = useState<{ key: string; name: string }[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A monitor saved from a Workflow agent keeps running as one.
  const runWith = RUN_WITH.some(option => option.value === model)
    ? RUN_WITH
    : [...RUN_WITH, { value: model, label: model, hint: '' }];

  const kind: MonitorKind = what === 'agent' ? 'agent' : 'check';
  const minimum = MIN_INTERVAL_MINUTES[kind];
  const needsDevice = what !== 'url';

  useEffect(() => {
    if (!needsDevice) return;
    remoteRunner
      .agentTargets(workspaceId)
      .then(list => {
        setDevices(list);
        if (!deviceKey && list[0]) setDeviceKey(list[0].key);
      })
      .catch(() => setDevices([]));
  }, [deviceKey, needsDevice, remoteRunner, workspaceId]);

  // Picking an agent copies what it does, so later edits to it don't change
  // a monitor that's already running.
  const pickAgent = useCallback(
    (id: string) => {
      setAgentId(id);
      const agent = deviceAgents.find(a => a.id === id);
      if (!agent) return;
      setInstructions(agent.instructions);
      setModel(runAs(agent).model);
      if (agent.deviceKey) setDeviceKey(agent.deviceKey);
      if (name === 'Monitor' || !name.trim()) setName(agent.name);
    },
    [deviceAgents, name]
  );

  const draft = useCallback((): MonitorDraft => {
    const agent = deviceAgents.find(a => a.id === agentId);
    return {
      name: name.trim(),
      docId,
      blockId,
      kind,
      source: what === 'agent' ? null : what,
      deviceKey: needsDevice ? deviceKey || null : null,
      spec:
        what === 'url'
          ? {
              url: url.trim(),
              extract: { type: extractType, pattern: pattern || undefined },
            }
          : what === 'command'
            ? {
                command: command.trim(),
                extract: { type: extractType, pattern: pattern || undefined },
              }
            : {
                instructions: instructions.trim(),
                model,
                tools:
                  (agent ? runAs(agent).tools : existing?.spec.tools) ?? [],
              },
      intervalMinutes: Math.max(interval, minimum),
      condition:
        conditionType === 'above' || conditionType === 'below'
          ? { type: conditionType, value: Number(conditionValue) }
          : { type: conditionType },
      alerts,
    };
  }, [
    agentId,
    alerts,
    blockId,
    command,
    conditionType,
    conditionValue,
    deviceAgents,
    deviceKey,
    docId,
    existing,
    extractType,
    instructions,
    interval,
    kind,
    minimum,
    model,
    name,
    needsDevice,
    pattern,
    url,
    what,
  ]);

  const test = useCallback(async () => {
    setTestResult(null);
    setBusy(true);
    try {
      const value = await monitorsService.test(draft().spec);
      setTestResult(`Found: ${value}`);
    } catch (err) {
      setTestResult(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [draft, monitorsService]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      if (existing) {
        await monitorsService.update(existing.id, draft());
        notify.success({ title: 'Monitor saved' });
      } else {
        await monitorsService.create(draft());
        notify.success({
          title: 'Monitoring',
          message: 'The first reading is on its way into the block.',
        });
      }
      close();
    } catch (err) {
      notify.error({
        title: "Couldn't save the monitor",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [close, draft, existing, monitorsService]);

  // A run started from here: the lastRunAt it started from, so the result
  // shows once a newer reading lands.
  const [runFrom, setRunFrom] = useState<number | null | undefined>(undefined);
  const running =
    runFrom !== undefined &&
    (!existing || existing.pending || existing.lastRunAt === runFrom);

  // A url check lands in seconds and a device job in minutes; look often
  // until it does.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      monitorsService.revalidate().catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [monitorsService, running]);

  // Saves the edits first, so the run is of what's in the form.
  const run = useCallback(async () => {
    if (!existing) return;
    setBusy(true);
    try {
      const saved = await monitorsService.update(existing.id, draft());
      setRunFrom(saved.lastRunAt);
      await monitorsService.runNow(existing.id);
    } catch (err) {
      setRunFrom(undefined);
      notify.error({
        title: "Couldn't run the monitor",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [draft, existing, monitorsService]);

  const runResult =
    runFrom === undefined || !existing
      ? null
      : running
        ? existing.kind === 'check' && existing.source === 'url'
          ? 'Running…'
          : 'Running on the device…'
        : existing.lastError
          ? `✗ ${existing.lastError}`
          : `Got: ${existing.lastValue ?? 'nothing'}`;

  const remove = useCallback(async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await monitorsService.remove(existing.id);
      close();
    } catch (err) {
      notify.error({ title: "Couldn't delete", message: String(err) });
    } finally {
      setBusy(false);
    }
  }, [close, existing, monitorsService]);

  const thresholdOk =
    (conditionType !== 'above' && conditionType !== 'below') ||
    Number.isFinite(Number.parseFloat(conditionValue));
  const sourceOk =
    what === 'url'
      ? /^https?:\/\//.test(url.trim())
      : what === 'command'
        ? !!command.trim() && !!deviceKey
        : !!instructions.trim() && !!deviceKey;
  const patternOk =
    what === 'agent' ||
    !['regex', 'jsonpath'].includes(extractType) ||
    !!pattern;
  const canSave =
    !!name.trim() && sourceOk && patternOk && thresholdOk && !busy;

  return (
    <Modal
      open
      onOpenChange={open => !open && close()}
      width={560}
      title={existing ? 'Edit monitor' : 'Monitor this block'}
      description="Checked on a schedule by the server; the latest result is written into this block."
    >
      <Scrollable.Root type="auto" className={styles.editorScrollRoot}>
        <Scrollable.Viewport className={styles.editorBody}>
          <div className={styles.field}>
            <span className={styles.label}>Name</span>
            <Input
              value={name}
              onChange={setName}
              placeholder="RTX 5090 price"
              data-testid="monitor-name"
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Watch</span>
            <div className={styles.checkGrid} role="radiogroup">
              {WHAT.map(option => (
                <label
                  key={option.value}
                  className={styles.check}
                  title={option.note}
                >
                  <Checkbox
                    role="radio"
                    aria-checked={what === option.value}
                    checked={what === option.value}
                    onChange={() => {
                      setWhat(option.value);
                      if (option.value === 'agent' && interval < 60)
                        setInterval(360);
                    }}
                    data-testid={`monitor-what-${option.value}`}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {what === 'url' ? (
            <div className={styles.field}>
              <span className={styles.label}>URL</span>
              <Input
                value={url}
                onChange={setUrl}
                placeholder="https://api.frankfurter.app/latest?from=USD&to=EUR"
                data-testid="monitor-url"
              />
              {isSearchEngine(url) ? (
                <span
                  className={styles.hint}
                  data-testid="monitor-url-search-engine"
                >
                  The server fetches this page; it doesn&apos;t search. To have
                  something look this up, watch with an agent instead.{' '}
                  <Button
                    variant="plain"
                    onClick={() => {
                      setWhat('agent');
                      if (interval < 60) setInterval(360);
                      if (!instructions.trim()) setInstructions(name.trim());
                    }}
                    data-testid="monitor-url-use-agent"
                  >
                    Use an agent
                  </Button>
                </span>
              ) : null}
            </div>
          ) : null}

          {what === 'command' ? (
            <div className={styles.field}>
              <span className={styles.label}>Command</span>
              <textarea
                className={styles.textarea}
                style={{
                  minHeight: 60,
                  fontFamily: 'var(--notesgraph-font-code-family, monospace)',
                }}
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder={"sqlite3 ~/data.db 'select count(*) from orders'"}
                data-testid="monitor-command"
              />
              <span className={styles.hint}>
                Runs with sh on the device. The device must allow it: set
                agent.allow_commands: true in its ~/.wf/config.yaml.
              </span>
            </div>
          ) : null}

          {what === 'agent' ? (
            <>
              {deviceAgents.length > 0 ? (
                <div className={styles.field}>
                  <span className={styles.label}>Start from an agent</span>
                  <select
                    className={styles.select}
                    value={agentId}
                    onChange={e => pickAgent(e.target.value)}
                    data-testid="monitor-agent"
                  >
                    <option value="">Write instructions below</option>
                    {deviceAgents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className={styles.field}>
                <span className={styles.label}>Run with</span>
                <select
                  className={styles.select}
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  data-testid="monitor-model"
                >
                  {runWith.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className={styles.hint}>
                  {runWith.find(option => option.value === model)?.hint}
                </span>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Instructions</span>
                <textarea
                  className={styles.textarea}
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  placeholder="Find the best current deals on an RTX 5090 in the US, new or open-box, with price and store."
                  data-testid="monitor-instructions"
                />
                <span className={styles.hint}>
                  Each run, the agent researches this and rewrites the block
                  with a one-line summary.
                </span>
              </div>
            </>
          ) : null}

          {needsDevice ? (
            <div className={styles.field}>
              <span className={styles.label}>Device</span>
              <select
                className={styles.select}
                value={deviceKey}
                onChange={e => setDeviceKey(e.target.value)}
                data-testid="monitor-device"
              >
                {devices.length === 0 ? (
                  <option value="">No devices accept agent work</option>
                ) : null}
                {devices.map(device => (
                  <option key={device.key} value={device.key}>
                    {device.name || device.key}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {what !== 'agent' ? (
            <div className={styles.field}>
              <span className={styles.label}>Read</span>
              <select
                className={styles.select}
                value={extractType}
                onChange={e => setExtractType(e.target.value as ExtractType)}
                data-testid="monitor-extract"
              >
                {EXTRACTORS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {extractType === 'regex' || extractType === 'jsonpath' ? (
                <Input
                  value={pattern}
                  onChange={setPattern}
                  placeholder={
                    extractType === 'jsonpath'
                      ? 'rates.EUR'
                      : 'fixed\\s+([\\d.]+)%'
                  }
                  data-testid="monitor-pattern"
                />
              ) : null}
              <span className={styles.hint}>
                {EXTRACTORS.find(option => option.value === extractType)?.hint}
              </span>
              {what === 'url' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button
                    onClick={() => void test()}
                    disabled={!sourceOk || busy}
                    data-testid="monitor-test"
                  >
                    Test
                  </Button>
                  {testResult ? (
                    <span className={styles.hint}>{testResult}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.field}>
            <span className={styles.label}>How often</span>
            <select
              className={styles.select}
              value={interval}
              onChange={e => setInterval(Number(e.target.value))}
              data-testid="monitor-interval"
            >
              {INTERVALS.filter(m => m >= minimum).map(minutes => (
                <option key={minutes} value={minutes}>
                  {intervalLabel(minutes)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Alert</span>
            <select
              className={styles.select}
              value={conditionType}
              onChange={e => setConditionType(e.target.value as ConditionType)}
              data-testid="monitor-condition"
            >
              {CONDITIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {conditionType === 'above' || conditionType === 'below' ? (
              <Input
                value={conditionValue}
                onChange={setConditionValue}
                placeholder="2000"
                data-testid="monitor-threshold"
              />
            ) : null}
            <div className={styles.checkGrid}>
              {(
                [
                  ['inApp', 'In the app'],
                  ['push', 'Phone'],
                  ['email', 'Email'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={styles.check}>
                  <Checkbox
                    checked={alerts[key]}
                    onChange={() =>
                      setAlerts(prev => ({ ...prev, [key]: !prev[key] }))
                    }
                    data-testid={`monitor-alert-${key}`}
                  />
                  {label}
                </label>
              ))}
            </div>
            <span className={styles.hint}>
              The block is always kept current; these say how else to tell you.
              Untick all for block-only.
            </span>
          </div>
        </Scrollable.Viewport>
        <Scrollable.Scrollbar />
      </Scrollable.Root>

      {runResult ? (
        <div
          className={styles.hint}
          style={{ marginTop: 12 }}
          role="status"
          data-testid="monitor-run-result"
        >
          {runResult}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 16,
        }}
      >
        <div>
          {existing ? (
            <Button
              variant="error"
              onClick={() => void remove()}
              disabled={busy}
              data-testid="monitor-delete"
            >
              Delete
            </Button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => close()}>Cancel</Button>
          {existing && runEnabled ? (
            <Button
              onClick={() => void run()}
              disabled={!canSave || running}
              title="Saves your changes, then runs it once now"
              data-testid="monitor-run"
            >
              {running ? 'Running…' : 'Run'}
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={!canSave}
            data-testid="monitor-save"
          >
            {existing ? 'Save' : 'Start monitoring'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
