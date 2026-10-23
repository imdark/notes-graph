import type {
  AutomationRunStatus,
  AutomationTrigger,
  AutomationTriggerType,
} from '@notesgraph/core/modules/agents';

/** Names the editor gives each kind of trigger. */
export const TRIGGER_TYPE_LABELS: Record<AutomationTriggerType, string> = {
  hook: 'Around agent runs',
  cron: 'On a schedule (cron)',
  interval: 'Every few minutes',
  event: 'When something happens',
  webhook: 'From a webhook',
  manual: 'Only when run by hand',
};

export const EVENT_LABELS: Record<string, string> = {
  'job.finished': 'an agent run ends',
  'run.started': 'an agent run starts',
  'run.failed': 'an agent run fails',
  'monitor.reading': 'a monitor takes a reading',
  'doc.updated': 'a note changes',
};

/** A trigger in a few words, for the list. */
export function describeTrigger(
  trigger: AutomationTrigger,
  names: { agent?: (id: string) => string | undefined } = {}
): string {
  const agent = (id?: string) =>
    id ? (names.agent?.(id) ?? 'one agent') : 'any agent';
  switch (trigger.type) {
    case 'hook': {
      const who = agent(trigger.filter?.agentId);
      const where = trigger.filter?.deviceKey
        ? ` on ${trigger.filter.deviceKey}`
        : '';
      return trigger.hook === 'prestart'
        ? `Before ${who} starts${where}`
        : `After ${who} ends${where}`;
    }
    case 'cron':
      return `Cron ${trigger.expr} (${trigger.tz ?? 'UTC'})`;
    case 'interval':
      return trigger.minutes % 60 === 0
        ? `Every ${trigger.minutes / 60 === 1 ? 'hour' : `${trigger.minutes / 60} hours`}`
        : `Every ${trigger.minutes} min`;
    case 'event':
      return `When ${EVENT_LABELS[trigger.event] ?? trigger.event}`;
    case 'webhook':
      return 'Webhook';
    case 'manual':
      return 'By hand';
  }
}

/** A trigger of this type with sensible starting values. */
export function newTrigger(type: AutomationTriggerType): AutomationTrigger {
  switch (type) {
    case 'hook':
      return { type: 'hook', hook: 'end' };
    case 'cron':
      return { type: 'cron', expr: '0 9 * * 1-5' };
    case 'interval':
      return { type: 'interval', minutes: 60 };
    case 'event':
      return { type: 'event', event: 'job.finished' };
    case 'webhook':
      return { type: 'webhook' };
    case 'manual':
      return { type: 'manual' };
  }
}

/** What the editor would refuse to save, or null. Mirrors the server's checks. */
export function triggerProblem(trigger: AutomationTrigger): string | null {
  if (trigger.type === 'cron' && trigger.expr.trim().split(/\s+/).length < 5) {
    return 'A cron needs five fields: minute hour day month weekday.';
  }
  if (trigger.type === 'interval' && !(trigger.minutes >= 1)) {
    return 'An interval is at least 1 minute.';
  }
  if (
    trigger.type === 'event' &&
    trigger.event === 'doc.updated' &&
    !trigger.filter?.docId
  ) {
    return 'Pick the note to watch.';
  }
  return null;
}

export const RUN_STATUS_LABELS: Record<AutomationRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
};

/** Seconds ago, in a few words. */
export function ago(epochSeconds: number, now = Date.now()): string {
  const diff = Math.max(0, now / 1000 - epochSeconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** A run's output for display: JSON pretty-printed, text as is. */
export function showOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}
