import { Button, Input, notify, Switch } from '@notesgraph/component';
import {
  type Automation,
  AUTOMATION_EVENTS,
  AUTOMATION_RUNTIME_LABELS,
  type AutomationEvent,
  type AutomationRuntime,
  type AutomationsService,
  type AutomationTrigger,
  type AutomationTriggerType,
  BLANK_ACTIONS_CODE,
  BLANK_AUTOMATION_CODE,
} from '@notesgraph/core/modules/agents';
import { useCallback, useMemo, useState } from 'react';

import {
  EVENT_LABELS,
  newTrigger,
  TRIGGER_TYPE_LABELS,
  triggerProblem,
} from './describe';
import * as styles from './styles.css';

export interface EditorStart {
  automation?: Automation;
  name: string;
  triggers: AutomationTrigger[];
  code: string;
}

export interface Choices {
  /** Devices that allow running code: key and name. */
  devices: { key: string; name: string }[];
  agents: { id: string; name: string }[];
  /** The workspace's secret names. */
  secrets: string[];
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const TRIGGER_TYPES = Object.keys(
  TRIGGER_TYPE_LABELS
) as AutomationTriggerType[];

/** One trigger's fields; which ones depends on its type. */
const TriggerFields = ({
  trigger,
  choices,
  onChange,
}: {
  trigger: AutomationTrigger;
  choices: Choices;
  onChange: (next: AutomationTrigger) => void;
}) => {
  const agentPicker = (
    agentId: string | undefined,
    set: (id?: string) => void
  ) => (
    <select
      className={styles.select}
      value={agentId ?? ''}
      onChange={e => set(e.target.value || undefined)}
      aria-label="Agent"
    >
      <option value="">Any agent</option>
      {choices.agents.map(agent => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  );
  const devicePicker = (
    deviceKey: string | undefined,
    set: (key?: string) => void
  ) => (
    <select
      className={styles.select}
      value={deviceKey ?? ''}
      onChange={e => set(e.target.value || undefined)}
      aria-label="Device"
    >
      <option value="">Any device</option>
      {choices.devices.map(device => (
        <option key={device.key} value={device.key}>
          {device.name}
        </option>
      ))}
    </select>
  );

  switch (trigger.type) {
    case 'hook':
      return (
        <>
          <select
            className={styles.select}
            value={trigger.hook}
            onChange={e =>
              onChange({
                ...trigger,
                hook: e.target.value as 'prestart' | 'end',
              })
            }
            aria-label="When"
          >
            <option value="prestart">before it starts</option>
            <option value="end">after it ends</option>
          </select>
          {agentPicker(trigger.filter?.agentId, agentId =>
            onChange({ ...trigger, filter: { ...trigger.filter, agentId } })
          )}
          {devicePicker(trigger.filter?.deviceKey, deviceKey =>
            onChange({ ...trigger, filter: { ...trigger.filter, deviceKey } })
          )}
        </>
      );
    case 'cron':
      return (
        <>
          <Input
            value={trigger.expr}
            onChange={expr => onChange({ ...trigger, expr })}
            placeholder="0 9 * * 1-5"
            style={{ width: 140, fontFamily: 'monospace' }}
          />
          <Input
            value={trigger.tz ?? ''}
            onChange={tz => onChange({ ...trigger, tz: tz || undefined })}
            placeholder="UTC"
            style={{ width: 160 }}
          />
        </>
      );
    case 'interval':
      return (
        <>
          <Input
            type="number"
            value={String(trigger.minutes)}
            onChange={minutes =>
              onChange({ ...trigger, minutes: Number(minutes) })
            }
            style={{ width: 80 }}
          />
          <span className={styles.hint}>minutes</span>
        </>
      );
    case 'event':
      return (
        <>
          <select
            className={styles.select}
            value={trigger.event}
            onChange={e =>
              onChange({
                type: 'event',
                event: e.target.value as AutomationEvent,
              })
            }
            aria-label="Event"
          >
            {AUTOMATION_EVENTS.map(event => (
              <option key={event} value={event}>
                {EVENT_LABELS[event]}
              </option>
            ))}
          </select>
          {trigger.event === 'doc.updated' ||
          trigger.event === 'monitor.reading' ? (
            <Input
              value={
                (trigger.event === 'doc.updated'
                  ? trigger.filter?.docId
                  : trigger.filter?.monitorId) ?? ''
              }
              onChange={id =>
                onChange({
                  ...trigger,
                  filter:
                    trigger.event === 'doc.updated'
                      ? { docId: id || undefined }
                      : { monitorId: id || undefined },
                })
              }
              placeholder={
                trigger.event === 'doc.updated'
                  ? 'Note id (required)'
                  : 'Monitor id (any if blank)'
              }
              style={{ width: 220 }}
            />
          ) : (
            <>
              {agentPicker(trigger.filter?.agentId, agentId =>
                onChange({ ...trigger, filter: { ...trigger.filter, agentId } })
              )}
              {devicePicker(trigger.filter?.deviceKey, deviceKey =>
                onChange({
                  ...trigger,
                  filter: { ...trigger.filter, deviceKey },
                })
              )}
            </>
          )}
        </>
      );
    default:
      return null;
  }
};

/** What a hook's code gets and may return, shown under the code box. */
const HookHelp = ({ triggers }: { triggers: AutomationTrigger[] }) => {
  const hooks = new Set(
    triggers.flatMap(t => (t.type === 'hook' ? [t.hook] : []))
  );
  if (!hooks.size) return null;
  return (
    <div className={styles.hint}>
      {hooks.has('prestart') ? (
        <div>
          <b>Before a run:</b> <code>input.job</code> has its instructions,
          context, agent and tasks. Return <code>false</code> or{' '}
          <code>{'{ allow: false, reason }'}</code> to stop it, or{' '}
          <code>{'{ instructions, context }'}</code> to rewrite them. If this
          code fails or never runs, the run is stopped too.
        </div>
      ) : null}
      {hooks.has('end') ? (
        <div>
          <b>After a run:</b> <code>input.job</code> has its status, result and
          error; <code>input.tasks</code> maps each task to the status the run
          left it in (<code>[-]</code> is in progress). Return{' '}
          <code>{"{ status: 'error', error }"}</code> to fail it, and/or{' '}
          <code>{"{ tasks: { <id>: 'FAILED' } }"}</code> to set its tasks.
        </div>
      ) : null}
    </div>
  );
};

/**
 * Make or change an automation: what starts it, its code, the secrets it
 * reads and the device it runs on. Saving saves the code as a new version
 * and deploys it there.
 */
export const AutomationEditor = ({
  start,
  choices,
  service,
  onSaved,
  onCancel,
}: {
  start: EditorStart;
  choices: Choices;
  service: AutomationsService;
  onSaved: (automation: Automation, webhookToken?: string) => void;
  onCancel: () => void;
}) => {
  const existing = start.automation;
  const deployedTo = existing?.deployments[0]?.target ?? '';
  const [name, setName] = useState(start.name);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [triggers, setTriggers] = useState<AutomationTrigger[]>(start.triggers);
  const [code, setCode] = useState(start.code);
  const [runtime, setRuntime] = useState<AutomationRuntime>(
    existing?.runtime ?? 'node'
  );
  // Switching between JavaScript and YAML swaps an untouched starter for
  // the other's.
  const changeRuntime = (next: AutomationRuntime) => {
    setRuntime(next);
    setCode(current =>
      next === 'actions' && current === BLANK_AUTOMATION_CODE
        ? BLANK_ACTIONS_CODE
        : next !== 'actions' && current === BLANK_ACTIONS_CODE
          ? BLANK_AUTOMATION_CODE
          : current
    );
  };
  const [secrets, setSecrets] = useState<string[]>(existing?.secrets ?? []);
  const [timeout, setTimeoutSeconds] = useState(
    String(existing?.timeoutSeconds ?? 60)
  );
  const [retries, setRetries] = useState(String(existing?.maxRetries ?? 0));
  const [target, setTarget] = useState(
    deployedTo || choices.devices.find(d => d.key === 'cloud')?.key || ''
  );
  const [saving, setSaving] = useState(false);

  const problems = useMemo(() => triggers.map(triggerProblem), [triggers]);
  const canSave =
    !!name.trim() && !!code.trim() && problems.every(p => !p) && !saving;

  const setTrigger = (index: number, next: AutomationTrigger) =>
    setTriggers(list => list.map((t, i) => (i === index ? next : t)));

  const save = useCallback(() => {
    if (!canSave) return;
    setSaving(true);
    const draft = {
      name: name.trim(),
      runtime,
      triggers,
      secrets,
      timeoutSeconds: Number(timeout) || 60,
      maxRetries: Number(retries) || 0,
      enabled,
    };
    (async () => {
      let automation: Automation;
      let webhookToken: string | undefined;
      if (existing) {
        ({ automation, webhookToken } = await service.update(
          existing.id,
          draft
        ));
        await service.saveCode(existing.id, code);
      } else {
        ({ automation, webhookToken } = await service.create(draft, code));
      }
      // The latest version goes to the chosen device; a device it is no
      // longer meant for stops running it.
      if (deployedTo && deployedTo !== target) {
        await service.undeploy(automation.id, deployedTo);
      }
      if (target) await service.deploy(automation.id, target);
      onSaved(
        service.automations$.value.find(a => a.id === automation.id) ??
          automation,
        webhookToken
      );
    })()
      .catch(err => {
        notify.error({
          title: existing
            ? `Couldn't save ${existing.name}`
            : `Couldn't create ${name.trim() || 'the automation'}`,
          message: errorMessage(err),
        });
      })
      .finally(() => setSaving(false));
  }, [
    canSave,
    code,
    deployedTo,
    enabled,
    existing,
    name,
    onSaved,
    retries,
    runtime,
    secrets,
    service,
    target,
    timeout,
    triggers,
  ]);

  return (
    <div className={styles.form} data-testid="automation-editor">
      <div className={styles.fieldRow}>
        <label className={styles.field} style={{ flex: 3 }}>
          Name
          <Input
            value={name}
            onChange={setName}
            placeholder="Mark tasks FAILED when a run fails"
            autoFocus={!existing}
            data-testid="automation-name"
          />
        </label>
        <label className={styles.field} style={{ flex: 0, minWidth: 90 }}>
          On
          <Switch checked={enabled} onChange={setEnabled} />
        </label>
      </div>

      <div className={styles.field}>
        Runs
        {triggers.map((trigger, index) => (
          <div key={index}>
            <div className={styles.trigger}>
              <select
                className={styles.select}
                value={trigger.type}
                onChange={e =>
                  setTrigger(
                    index,
                    newTrigger(e.target.value as AutomationTriggerType)
                  )
                }
                aria-label="Trigger"
              >
                {TRIGGER_TYPES.map(type => (
                  <option key={type} value={type}>
                    {TRIGGER_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <TriggerFields
                trigger={trigger}
                choices={choices}
                onChange={next => setTrigger(index, next)}
              />
              <span style={{ flex: 1 }} />
              <Button
                variant="plain"
                onClick={() =>
                  setTriggers(list => list.filter((_, i) => i !== index))
                }
              >
                Remove
              </Button>
            </div>
            {problems[index] ? (
              <span className={styles.fieldError}>{problems[index]}</span>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            variant="plain"
            onClick={() => setTriggers(list => [...list, newTrigger('hook')])}
          >
            Add a trigger
          </Button>
        </div>
        {triggers.length === 0 ? (
          <span className={styles.hint}>
            With no trigger it only runs when you press Run now.
          </span>
        ) : null}
      </div>

      <label className={styles.field}>
        Written in
        <select
          className={styles.select}
          value={runtime}
          onChange={e => changeRuntime(e.target.value as AutomationRuntime)}
          data-testid="automation-runtime"
        >
          {(Object.keys(AUTOMATION_RUNTIME_LABELS) as AutomationRuntime[]).map(
            value => (
              <option key={value} value={value}>
                {AUTOMATION_RUNTIME_LABELS[value]}
              </option>
            )
          )}
        </select>
        {runtime === 'shell' ? (
          <span className={styles.hint}>
            <code>await sh(command, {'{cwd}'})</code> runs a command on the
            device and resolves to <code>{'{code, output}'}</code>; a failing
            one throws.
          </span>
        ) : null}
      </label>

      <label className={styles.field}>
        {runtime === 'actions' ? 'Actions (YAML)' : 'Code (JavaScript)'}
        <textarea
          className={styles.code}
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          data-testid="automation-code"
        />
        <HookHelp triggers={triggers} />
      </label>

      <div className={styles.field}>
        Secrets it may read, as <code>secrets.NAME</code>
        {choices.secrets.length ? (
          <div className={styles.chips}>
            {choices.secrets.map(secret => {
              const on = secrets.includes(secret);
              return (
                <button
                  key={secret}
                  type="button"
                  className={styles.chip}
                  data-on={on}
                  onClick={() =>
                    setSecrets(list =>
                      on ? list.filter(s => s !== secret) : [...list, secret]
                    )
                  }
                >
                  {secret}
                </button>
              );
            })}
          </div>
        ) : (
          <span className={styles.hint}>
            This workspace has no secrets. Add them on the Secrets page.
          </span>
        )}
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field} style={{ flex: 2 }}>
          Runs on
          <select
            className={styles.select}
            value={target}
            onChange={e => setTarget(e.target.value)}
            data-testid="automation-target"
          >
            <option value="">Nowhere yet (not deployed)</option>
            {choices.devices.map(device => (
              <option key={device.key} value={device.key}>
                {device.name}
              </option>
            ))}
          </select>
          {choices.devices.length === 0 ? (
            <span className={styles.hint}>
              No device allows running code. Register one with agent execution
              allowed.
            </span>
          ) : null}
        </label>
        <label className={styles.field}>
          Time limit (seconds)
          <Input type="number" value={timeout} onChange={setTimeoutSeconds} />
        </label>
        <label className={styles.field}>
          Retries on failure
          <Input type="number" value={retries} onChange={setRetries} />
        </label>
      </div>

      <div className={styles.formActions}>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={!canSave}
          loading={saving}
          data-testid="automation-save"
        >
          {existing ? 'Save' : target ? 'Create and deploy' : 'Create'}
        </Button>
      </div>
    </div>
  );
};
