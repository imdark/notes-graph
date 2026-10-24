import {
  Button,
  Menu,
  MenuItem,
  notify,
  useConfirmModal,
} from '@notesgraph/component';
import {
  AgentsService,
  type Automation,
  type AutomationRun,
  AutomationsService,
  type AutomationTemplate,
  BLANK_AUTOMATION_CODE,
  FleetService,
  webhookUrl,
} from '@notesgraph/core/modules/agents';
import { GraphQLService } from '@notesgraph/core/modules/cloud';
import { WorkspacePermissionService } from '@notesgraph/core/modules/permissions';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { workspaceSecretsQuery } from '@notesgraph/graphql';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ago,
  describeTrigger,
  RUN_STATUS_LABELS,
  showOutput,
} from './describe';
import { AutomationEditor, type Choices, type EditorStart } from './editor';
import * as styles from './styles.css';

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** How often an open runs list looks again while a run is unfinished. */
const RUNS_POLL_MS = 4000;

/** One run, opened: its log, output and error. */
const RunDetail = ({
  service,
  automationId,
  runId,
}: {
  service: AutomationsService;
  automationId: string;
  runId: string;
}) => {
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    service
      .run(automationId, runId)
      .then(setRun)
      .catch(err => setError(errorMessage(err)));
  }, [automationId, runId, service]);
  if (error) return <span className={styles.fieldError}>{error}</span>;
  if (!run) return <span className={styles.hint}>Loading…</span>;
  const output = showOutput(run.output);
  return (
    <div className={styles.field}>
      {run.error ? (
        <span className={styles.fieldError}>{run.error}</span>
      ) : null}
      {output ? (
        <>
          Output
          <pre className={styles.pre}>{output}</pre>
        </>
      ) : null}
      Log
      <pre className={styles.pre}>{run.logs || '(nothing printed)'}</pre>
      {run.input !== null && run.input !== undefined ? (
        <>
          Input
          <pre className={styles.pre}>{showOutput(run.input)}</pre>
        </>
      ) : null}
    </div>
  );
};

/** An automation's recent runs, newest first; one opens to show its log. */
const Runs = ({
  service,
  automation,
  refresh,
}: {
  service: AutomationsService;
  automation: Automation;
  /** Changes when a run was just started, to look again at once. */
  refresh: number;
}) => {
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      service
        .runs(automation.id)
        .then(list => {
          if (stopped) return;
          setRuns(list);
          setError(null);
          if (list.some(r => r.status === 'queued' || r.status === 'running')) {
            timer = setTimeout(load, RUNS_POLL_MS);
          }
        })
        .catch(err => !stopped && setError(errorMessage(err)));
    };
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [automation.id, service, refresh]);

  if (error) return <span className={styles.fieldError}>{error}</span>;
  if (!runs) return <span className={styles.hint}>Loading runs…</span>;
  if (!runs.length) return <span className={styles.hint}>No runs yet.</span>;
  return (
    <div>
      {runs.slice(0, 20).map(run => (
        <div key={run.id}>
          <div
            className={styles.runRow}
            onClick={() => setOpen(open === run.id ? null : run.id)}
            data-testid="automation-run"
          >
            <span className={styles.status} data-status={run.status}>
              {RUN_STATUS_LABELS[run.status] ?? run.status}
            </span>
            <span>
              {run.trigger.hook
                ? `${run.trigger.hook} hook`
                : (run.trigger.event ?? run.trigger.type)}
              {run.attempt > 1 ? ` · attempt ${run.attempt}` : ''} · on{' '}
              {run.target} · {ago(run.createdAt)}
            </span>
            {run.error ? (
              <span className={styles.meta} style={{ flex: 1 }}>
                {run.error}
              </span>
            ) : null}
          </div>
          {open === run.id ? (
            <RunDetail
              service={service}
              automationId={automation.id}
              runId={run.id}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
};

/**
 * The workspace's automations: code that runs on a schedule, on an event, a
 * webhook or a click, or around agent runs (prestart and end hooks).
 */
export const AutomationsView = () => {
  const service = useService(AutomationsService);
  const fleet = useService(FleetService);
  const agentsService = useService(AgentsService);
  const graphql = useService(GraphQLService);
  const workspace = useService(WorkspaceService).workspace;
  const permission = useService(WorkspacePermissionService).permission;
  const canEdit = useLiveData(permission.isOwnerOrAdmin$);
  const automations = useLiveData(service.automations$);
  const loaded = useLiveData(service.loaded$);
  const loadError = useLiveData(service.error$);
  const devices = useLiveData(fleet.devices$);
  const agents = useLiveData(agentsService.agents$);
  const { openConfirmModal } = useConfirmModal();
  const isLocal = workspace.flavour === 'local';

  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
  // 'new' or an automation's id while it is being edited.
  const [editing, setEditing] = useState<{
    id: string;
    start: EditorStart;
  } | null>(null);
  const [runsOpen, setRunsOpen] = useState<string | null>(null);
  const [runsRefresh, setRunsRefresh] = useState(0);
  const [token, setToken] = useState<{ name: string; token: string } | null>(
    null
  );

  useEffect(() => {
    if (isLocal) return;
    permission.revalidate();
    const stopAutomations = service.watch();
    const stopFleet = fleet.watch();
    graphql
      .gql({
        query: workspaceSecretsQuery,
        variables: { workspaceId: workspace.id },
      })
      .then(data => setSecretNames(data.workspace.secrets.map(s => s.name)))
      .catch(() => {});
    service
      .templates()
      .then(setTemplates)
      .catch(() => {});
    return () => {
      stopAutomations();
      stopFleet();
    };
  }, [fleet, graphql, isLocal, permission, service, workspace.id]);

  const choices: Choices = useMemo(
    () => ({
      devices: devices
        .filter(d => d.agentTarget)
        .map(d => ({ key: d.key, name: d.name || d.key })),
      agents: agents.map(a => ({ id: a.id, name: a.name })),
      secrets: secretNames,
    }),
    [agents, devices, secretNames]
  );
  const agentName = useCallback(
    (id: string) => agents.find(a => a.id === id)?.name,
    [agents]
  );
  const deviceName = useCallback(
    (key: string) => devices.find(d => d.key === key)?.name || key,
    [devices]
  );

  const startNew = (template?: AutomationTemplate) =>
    setEditing({
      id: 'new',
      start: {
        name: template?.name ?? '',
        triggers: template?.triggers ?? [{ type: 'manual' }],
        code: template?.code ?? BLANK_AUTOMATION_CODE,
      },
    });

  const edit = (automation: Automation) => {
    service
      .get(automation.id)
      .then(details =>
        setEditing({
          id: automation.id,
          start: {
            automation: details.automation,
            name: details.automation.name,
            triggers: details.automation.triggers,
            code: details.code ?? BLANK_AUTOMATION_CODE,
          },
        })
      )
      .catch(err =>
        notify.error({
          title: `Couldn't open ${automation.name}`,
          message: errorMessage(err),
        })
      );
  };

  const saved = (automation: Automation, webhookToken?: string) => {
    setEditing(null);
    if (webhookToken) setToken({ name: automation.name, token: webhookToken });
    notify.success({ title: `Saved ${automation.name}` });
  };

  const runNow = (automation: Automation) => {
    service
      .runNow(automation.id)
      .then(() => {
        setRunsOpen(automation.id);
        setRunsRefresh(n => n + 1);
      })
      .catch(err =>
        notify.error({
          title: `Couldn't run ${automation.name}`,
          message: errorMessage(err),
        })
      );
  };

  const toggle = (automation: Automation) => {
    service.update(automation.id, { enabled: !automation.enabled }).catch(err =>
      notify.error({
        title: `Couldn't change ${automation.name}`,
        message: errorMessage(err),
      })
    );
  };

  const rotate = (automation: Automation) => {
    openConfirmModal({
      title: `New webhook URL for ${automation.name}?`,
      description:
        'The old URL stops working at once. Anything calling it needs the new one.',
      confirmText: 'Make a new URL',
      onConfirm: async () => {
        try {
          const webhookToken = await service.rotateToken(automation.id);
          setToken({ name: automation.name, token: webhookToken });
        } catch (err) {
          notify.error({
            title: `Couldn't make a new URL`,
            message: errorMessage(err),
          });
        }
      },
    });
  };

  const remove = (automation: Automation) => {
    openConfirmModal({
      title: `Delete ${automation.name}?`,
      description:
        'Its code, versions and runs go with it. Hooks it ran stop applying to agent runs.',
      confirmText: 'Delete',
      confirmButtonOptions: { variant: 'error' },
      onConfirm: async () => {
        try {
          await service.remove(automation.id);
        } catch (err) {
          notify.error({
            title: `Couldn't delete ${automation.name}`,
            message: errorMessage(err),
          });
        }
      },
    });
  };

  if (isLocal) {
    return (
      <div className={styles.content}>
        <div className={styles.empty}>
          Automations run on the server and its devices, so a local workspace
          has none. Enable cloud for it in workspace settings to add some.
        </div>
      </div>
    );
  }

  const editor = (start: EditorStart) => (
    <AutomationEditor
      start={start}
      choices={choices}
      service={service}
      onSaved={saved}
      onCancel={() => setEditing(null)}
    />
  );

  return (
    <div className={styles.content}>
      <p className={styles.intro}>
        Code that runs on one of your devices: on a schedule, when something
        happens in the workspace, from a webhook, or around agent runs. A hook
        can check a run before it starts, and check its output or fix up its
        tasks after it ends.
        {canEdit === false
          ? ' Only workspace owners and admins can add or change them.'
          : null}
      </p>

      {token ? (
        <div className={styles.banner} data-testid="automation-webhook">
          <span>
            Webhook URL for <b>{token.name}</b>. It is shown only now: copy it
            somewhere safe. A POST to it starts a run with the request body as{' '}
            <code>input</code>.
          </span>
          <span className={styles.url}>
            {webhookUrl(service.baseUrl, token.token)}
          </span>
          <div className={styles.formActions}>
            <Button
              onClick={() => {
                navigator.clipboard
                  .writeText(webhookUrl(service.baseUrl, token.token))
                  .then(() => notify.success({ title: 'Copied' }))
                  .catch(() => {});
              }}
            >
              Copy
            </Button>
            <Button variant="plain" onClick={() => setToken(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <span className={styles.sectionTitle}>
          Automations
          {loaded ? (
            <span className={styles.sectionCount}>{automations.length}</span>
          ) : null}
        </span>
        {canEdit && editing?.id !== 'new' ? (
          <Menu
            items={
              <>
                <MenuItem onClick={() => startNew()}>Blank</MenuItem>
                {templates.map(template => (
                  <MenuItem
                    key={template.id}
                    onClick={() => startNew(template)}
                  >
                    {template.name}
                  </MenuItem>
                ))}
              </>
            }
          >
            <Button variant="primary" data-testid="automation-add">
              New automation
            </Button>
          </Menu>
        ) : null}
      </div>

      {editing?.id === 'new' ? editor(editing.start) : null}

      {loadError && !automations.length ? (
        <div className={styles.empty}>
          Couldn&apos;t load automations: {loadError}{' '}
          <Button
            variant="plain"
            onClick={() => {
              service.revalidate().catch(() => {});
            }}
          >
            Try again
          </Button>
        </div>
      ) : !loaded ? (
        <div className={styles.empty}>Loading automations…</div>
      ) : automations.length === 0 ? (
        editing ? null : (
          <div className={styles.empty}>
            No automations yet.
            {canEdit && templates.length
              ? ` Start from "${templates[0].name}" under New automation.`
              : null}
          </div>
        )
      ) : (
        automations.map(automation =>
          editing?.id === automation.id ? (
            <div key={automation.id}>{editor(editing.start)}</div>
          ) : (
            <div
              key={automation.id}
              className={styles.card}
              data-testid="automation-row"
            >
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.name}>
                    {automation.name}
                    {automation.enabled ? null : (
                      <span className={styles.sectionCount}>off</span>
                    )}
                  </span>
                  <span className={styles.meta}>
                    {automation.triggers.length
                      ? automation.triggers
                          .map(t => describeTrigger(t, { agent: agentName }))
                          .join(' · ')
                      : 'By hand'}
                    {' · '}
                    {automation.deployments.length
                      ? `on ${automation.deployments
                          .map(d => deviceName(d.target))
                          .join(', ')}`
                      : 'not deployed'}
                    {automation.lastRunAt
                      ? ` · ran ${ago(automation.lastRunAt)}`
                      : ''}
                  </span>
                </div>
                <div className={styles.actions}>
                  <Button
                    variant="plain"
                    onClick={() =>
                      setRunsOpen(
                        runsOpen === automation.id ? null : automation.id
                      )
                    }
                  >
                    {runsOpen === automation.id ? 'Hide runs' : 'Runs'}
                  </Button>
                  {canEdit ? (
                    <>
                      <Button
                        variant="plain"
                        onClick={() => runNow(automation)}
                        disabled={!automation.deployments.length}
                      >
                        Run now
                      </Button>
                      <Button variant="plain" onClick={() => edit(automation)}>
                        Edit
                      </Button>
                      <Menu
                        items={
                          <>
                            <MenuItem onClick={() => toggle(automation)}>
                              {automation.enabled ? 'Turn off' : 'Turn on'}
                            </MenuItem>
                            {automation.hasWebhook ? (
                              <MenuItem onClick={() => rotate(automation)}>
                                New webhook URL
                              </MenuItem>
                            ) : null}
                            <MenuItem
                              type="danger"
                              onClick={() => remove(automation)}
                            >
                              Delete
                            </MenuItem>
                          </>
                        }
                      >
                        <Button variant="plain">More</Button>
                      </Menu>
                    </>
                  ) : null}
                </div>
              </div>
              {runsOpen === automation.id ? (
                <div className={styles.section}>
                  <Runs
                    service={service}
                    automation={automation}
                    refresh={runsRefresh}
                  />
                </div>
              ) : null}
            </div>
          )
        )
      )}
    </div>
  );
};
