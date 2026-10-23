import { CronTime } from 'cron';

/**
 * What starts an automation. A schedule (cron or interval) books its next
 * run in `nextRunAt`; an event, a webhook or a click starts one directly.
 */
export type Trigger =
  /** `tz` is an IANA zone; UTC without one. */
  | { type: 'cron'; expr: string; tz?: string }
  | { type: 'interval'; minutes: number }
  | { type: 'event'; event: AutomationEvent; filter?: EventFilter }
  | { type: 'webhook' }
  | { type: 'manual' };

/** Workspace events an automation can start on. */
export const AUTOMATION_EVENTS = [
  'job.finished',
  'run.started',
  'run.failed',
  'monitor.reading',
  'doc.updated',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

/**
 * Narrows an event trigger: every field given must equal the event's own.
 * `doc.updated` needs a docId, or every keystroke in the workspace would
 * start a run.
 */
export interface EventFilter {
  agentId?: string;
  deviceKey?: string;
  monitorId?: string;
  docId?: string;
  status?: string;
}

/** A schedule never fires more often than this. */
export const MIN_INTERVAL_MINUTES = 1;
/** Most triggers one automation may have. */
const MAX_TRIGGERS = 10;
const FILTER_KEYS: (keyof EventFilter)[] = [
  'agentId',
  'deviceKey',
  'monitorId',
  'docId',
  'status',
];

export class TriggerError extends Error {}

/** Check a person's triggers; throws a TriggerError saying what is wrong. */
export function parseTriggers(raw: unknown): Trigger[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new TriggerError('triggers must be a list');
  if (raw.length > MAX_TRIGGERS) {
    throw new TriggerError(`at most ${MAX_TRIGGERS} triggers`);
  }
  return raw.map(parseTrigger);
}

function parseTrigger(raw: unknown): Trigger {
  const t = (raw ?? {}) as Record<string, unknown>;
  switch (t.type) {
    case 'cron': {
      const expr = String(t.expr ?? '').trim();
      const tz = t.tz ? String(t.tz) : undefined;
      try {
        new CronTime(expr, tz);
      } catch (err) {
        throw new TriggerError(`bad cron "${expr}": ${(err as Error).message}`);
      }
      if (cronFiresEverySecond(expr)) {
        throw new TriggerError('a cron trigger fires at most once a minute');
      }
      return tz ? { type: 'cron', expr, tz } : { type: 'cron', expr };
    }
    case 'interval': {
      const minutes = Number(t.minutes);
      if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES) {
        throw new TriggerError(
          `an interval is at least ${MIN_INTERVAL_MINUTES} minute`
        );
      }
      return { type: 'interval', minutes: Math.round(minutes) };
    }
    case 'event': {
      const event = String(t.event ?? '') as AutomationEvent;
      if (!AUTOMATION_EVENTS.includes(event)) {
        throw new TriggerError(
          `event must be one of ${AUTOMATION_EVENTS.join(', ')}`
        );
      }
      const rawFilter = (t.filter ?? {}) as Record<string, unknown>;
      const filter: EventFilter = {};
      for (const key of FILTER_KEYS) {
        if (rawFilter[key] != null && rawFilter[key] !== '') {
          filter[key] = String(rawFilter[key]);
        }
      }
      if (event === 'doc.updated' && !filter.docId) {
        throw new TriggerError('a doc.updated trigger needs a docId');
      }
      return Object.keys(filter).length
        ? { type: 'event', event, filter }
        : { type: 'event', event };
    }
    case 'webhook':
      return { type: 'webhook' };
    case 'manual':
      return { type: 'manual' };
    default:
      throw new TriggerError(
        'trigger type must be cron, interval, event, webhook or manual'
      );
  }
}

/** A six-field cron whose seconds field isn't a single number. */
function cronFiresEverySecond(expr: string) {
  const fields = expr.split(/\s+/);
  return fields.length === 6 && !/^\d+$/.test(fields[0]);
}

/** When the earliest schedule fires next after `from`; null with none. */
export function nextRunAt(triggers: Trigger[], from: Date): Date | null {
  let next: Date | null = null;
  for (const trigger of triggers) {
    let at: Date | null = null;
    if (trigger.type === 'cron') {
      // The zone goes to both calls: without it here, the server's own zone
      // decides when the cron fires.
      const tz = trigger.tz ?? 'UTC';
      at = new CronTime(trigger.expr, tz).getNextDateFrom(from, tz).toJSDate();
    } else if (trigger.type === 'interval') {
      at = new Date(from.getTime() + trigger.minutes * 60_000);
    }
    if (at && (!next || at < next)) next = at;
  }
  return next;
}

/** Which of these triggers, if any, an event starts. */
export function matchingTrigger(
  triggers: Trigger[],
  event: AutomationEvent,
  fields: EventFilter
): Extract<Trigger, { type: 'event' }> | null {
  for (const trigger of triggers) {
    if (trigger.type !== 'event' || trigger.event !== event) continue;
    const filter = trigger.filter ?? {};
    if (FILTER_KEYS.every(key => !filter[key] || filter[key] === fields[key])) {
      return trigger;
    }
  }
  return null;
}

export const hasTrigger = (triggers: Trigger[], type: Trigger['type']) =>
  triggers.some(trigger => trigger.type === type);
