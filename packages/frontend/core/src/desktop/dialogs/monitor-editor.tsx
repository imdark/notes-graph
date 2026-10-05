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
  type ConditionType,
  type ExtractType,
  isDeviceClaudeModel,
  MIN_INTERVAL_MINUTES,
  type MonitorDraft,
  type MonitorKind,
  MonitorsService,
  RemoteAgentRunnerService,
} from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './setting/workspace-setting/agents/styles.css';

/** What a monitor watches, as the editor offers it. */
type What = 'url' | 'command' | 'agent';

const WHAT: { value: What; label: string; note: string }[] = [
  { value: 'url', label: 'A website or API', note: 'Fetched by the server' },
  { value: 'command', label: 'A command on a device', note: 'Shell, or a DB via psql/sqlite3' },
  { value: 'agent', label: 'An agent', note: 'Searches and rewrites the block itself' },
];

const EXTRACTORS: { value: ExtractType; label: string; hint: string }[] = [
  { value: 'number', label: 'A number', hint: 'The price on a shop page, or the first number' },
  { value: 'jsonpath', label: 'JSON path', hint: 'e.g. rates.EUR or data[0].price' },
  { value: 'regex', label: 'Regex', hint: 'The first capture group, e.g. fixed\\s+([\\d.]+)%' },
  { value: 'text', label: 'Text', hint: 'The whole output, trimmed' },
];

const CONDITIONS: { value: ConditionType; label: string }[] = [
  { value: 'change', label: 'When it changes' },
  { value: 'below', label: 'When it drops below…' },
  { value: 'above', label: 'When it rises above…' },
  { value: 'always', label: 'Every reading' },
];

const INTERVALS = [5, 15, 30, 60, 180, 360, 720, 1440];

const intervalLabel = (minutes: number) =>
  minutes < 60
    ? `Every ${minutes} minutes`
    : minutes === 60
      ? 'Every hour'
      : minutes < 1440
        ? `Every ${minutes / 60} hours`
        : 'Every day';

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
  const existing = useMemo(
    () => monitors.find(m => m.id === monitorId),
    [monitorId, monitors]
  );
  const allAgents = useLiveData(agentsService.agents$);
  // Only device Claude agents can run unattended on a schedule.
  const deviceAgents = useMemo(
    () => allAgents.filter((a: Agent) => a.harness === 'remote' && isDeviceClaudeModel(a.model)),
    [allAgents]
  );

  const [name, setName] = useState(existing?.name ?? (text?.trim().slice(0, 60) || 'Monitor'));
  const [what, setWhat] = useState<What>(
    existing ? (existing.kind === 'agent' ? 'agent' : (existing.source ?? 'url')) : 'url'
  );
  const [url, setUrl] = useState(existing?.spec.url ?? '');
  const [command, setCommand] = useState(existing?.spec.command ?? '');
  const [extractType, setExtractType] = useState<ExtractType>(
    existing?.spec.extract?.type ?? 'number'
  );
  const [pattern, setPattern] = useState(existing?.spec.extract?.pattern ?? '');
  const [agentId, setAgentId] = useState<string>('');
  const [instructions, setInstructions] = useState(existing?.spec.instructions ?? '');
  const [deviceKey, setDeviceKey] = useState(existing?.deviceKey ?? '');
  const [interval, setInterval] = useState(existing?.intervalMinutes ?? 60);
  const [conditionType, setConditionType] = useState<ConditionType>(
    existing?.condition.type ?? 'change'
  );
  const [conditionValue, setConditionValue] = useState(
    existing?.condition.value !== undefined ? String(existing.condition.value) : ''
  );
  const [alerts, setAlerts] = useState({
    inApp: existing?.alerts.inApp ?? true,
    push: existing?.alerts.push ?? false,
    email: existing?.alerts.email ?? false,
  });
  const [devices, setDevices] = useState<{ key: string; name: string }[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          ? { url: url.trim(), extract: { type: extractType, pattern: pattern || undefined } }
          : what === 'command'
            ? { command: command.trim(), extract: { type: extractType, pattern: pattern || undefined } }
            : {
                instructions: instructions.trim(),
                model: agent?.model ?? existing?.spec.model ?? 'claude-code',
                tools: agent?.tools ?? existing?.spec.tools ?? [],
              },
      intervalMinutes: Math.max(interval, minimum),
      condition:
        conditionType === 'above' || conditionType === 'below'
          ? { type: conditionType, value: Number(conditionValue) }
          : { type: conditionType },
      alerts,
    };
  }, [
    agentId, alerts, blockId, command, conditionType, conditionValue, deviceAgents,
    deviceKey, docId, existing, extractType, instructions, interval, kind, minimum,
    name, needsDevice, pattern, url, what,
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
  const patternOk = what === 'agent' || !['regex', 'jsonpath'].includes(extractType) || !!pattern;
  const canSave = !!name.trim() && sourceOk && patternOk && thresholdOk && !busy;

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
            <Input value={name} onChange={setName} placeholder="RTX 5090 price" data-testid="monitor-name" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Watch</span>
            <div className={styles.checkGrid} role="radiogroup">
              {WHAT.map(option => (
                <label key={option.value} className={styles.check} title={option.note}>
                  <Checkbox
                    role="radio"
                    aria-checked={what === option.value}
                    checked={what === option.value}
                    onChange={() => {
                      setWhat(option.value);
                      if (option.value === 'agent' && interval < 60) setInterval(360);
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
            </div>
          ) : null}

          {what === 'command' ? (
            <div className={styles.field}>
              <span className={styles.label}>Command</span>
              <textarea
                className={styles.textarea}
                style={{ minHeight: 60, fontFamily: 'var(--notesgraph-font-code-family, monospace)' }}
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
                <span className={styles.label}>Instructions</span>
                <textarea
                  className={styles.textarea}
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  placeholder="Find the best current deals on an RTX 5090 in the US, new or open-box, with price and store."
                  data-testid="monitor-instructions"
                />
                <span className={styles.hint}>
                  Each run, the agent researches this and rewrites the block with a one-line summary.
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
                {devices.length === 0 ? <option value="">No devices accept agent work</option> : null}
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
                  placeholder={extractType === 'jsonpath' ? 'rates.EUR' : 'fixed\\s+([\\d.]+)%'}
                  data-testid="monitor-pattern"
                />
              ) : null}
              <span className={styles.hint}>
                {EXTRACTORS.find(option => option.value === extractType)?.hint}
              </span>
              {what === 'url' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button onClick={() => void test()} disabled={!sourceOk || busy} data-testid="monitor-test">
                    Test
                  </Button>
                  {testResult ? <span className={styles.hint}>{testResult}</span> : null}
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
                    onChange={() => setAlerts(prev => ({ ...prev, [key]: !prev[key] }))}
                    data-testid={`monitor-alert-${key}`}
                  />
                  {label}
                </label>
              ))}
            </div>
            <span className={styles.hint}>
              The block is always kept current; these say how else to tell you. Untick all for block-only.
            </span>
          </div>
        </Scrollable.Viewport>
        <Scrollable.Scrollbar />
      </Scrollable.Root>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <div>
          {existing ? (
            <Button variant="error" onClick={() => void remove()} disabled={busy} data-testid="monitor-delete">
              Delete
            </Button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => close()}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave} data-testid="monitor-save">
            {existing ? 'Save' : 'Start monitoring'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
