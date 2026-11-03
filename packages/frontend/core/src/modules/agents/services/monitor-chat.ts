import type { ChatMessage } from './cloud-runner';
import type { Monitor, MonitorReading } from './monitors';
import type { RemoteJob } from './remote-runner';

/**
 * The opening of the monitor view's Ask chat: a separate conversation seeded
 * with what the monitor watches, its readings and its latest run, so the
 * reader can ask about the results. Nothing it says reaches the monitor or
 * the note.
 */

/** How many readings the chat is given, newest first. */
export const MONITOR_CHAT_READINGS = 50;
/** How much of the latest run's answer the chat is given. */
const OUTPUT_CHARS = 4_000;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** What the monitor is set up to do, one fact per line. */
export function monitorSetup(monitor: Monitor): string {
  const { spec, condition } = monitor;
  return [
    `Monitor: ${monitor.name}`,
    monitor.kind === 'agent'
      ? `An agent run on ${monitor.deviceKey ?? 'a device'} with ${spec.model ?? 'claude-code'}, every ${monitor.intervalMinutes} minutes.`
      : monitor.source === 'command'
        ? `A shell command on ${monitor.deviceKey ?? 'a device'}, every ${monitor.intervalMinutes} minutes.`
        : `A web check of ${spec.url ?? 'a URL'}, every ${monitor.intervalMinutes} minutes.`,
    spec.instructions
      ? `<instructions>\n${spec.instructions}\n</instructions>`
      : null,
    spec.command ? `Command: ${spec.command}` : null,
    spec.extract
      ? `Reads the value as ${spec.extract.type}${spec.extract.pattern ? ` (${spec.extract.pattern})` : ''}.`
      : null,
    condition.type === 'above' || condition.type === 'below'
      ? `Alerts when the value goes ${condition.type} ${condition.value}.`
      : condition.type === 'change'
        ? 'Alerts when the value changes.'
        : 'Alerts on every reading.',
    monitor.enabled ? null : 'It is paused.',
    monitor.lastError ? `Its last check failed: ${monitor.lastError}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Readings as the server lists them (newest first), one per line. */
export function readingLines(readings: MonitorReading[]): string {
  return readings
    .slice(0, MONITOR_CHAT_READINGS)
    .map(
      r =>
        `${iso(r.at)} ${r.error ? `failed: ${r.error}` : (r.value ?? '(empty)')}${r.alerted ? ' [alerted]' : ''}`
    )
    .join('\n');
}

export function monitorChatMessages(
  monitor: Monitor,
  {
    readings,
    run,
    transcript,
  }: {
    readings: MonitorReading[];
    /** The latest device job it ran, if any. */
    run?: RemoteJob | null;
    /** That run's transcript, stamps stripped (see forkTranscript). */
    transcript?: string;
  }
): ChatMessage[] {
  const instructions = [
    `You are answering the reader's questions about their monitor "${monitor.name}", which keeps a block of their notes up to date on a schedule.`,
    'You have how it is set up, its readings over time and, when it runs on a device, the transcript of its latest run. Explain what the results mean, how they moved, why a check failed, and what the latest run did.',
    "You cannot act: you don't run checks or change notes, and the monitor doesn't see this chat. If the reader wants it to work differently, say what to change in its setup.",
    "Be concise, and say plainly when the record doesn't tell you something rather than guessing.",
  ].join('\n');

  const answer = (run?.result ?? '').trim();
  const record = [
    monitorSetup(monitor),
    readings.length
      ? `<readings newest="first">\n${readingLines(readings)}\n</readings>`
      : 'It has no readings yet.',
    run
      ? [
          `Latest run: ${run.status}${run.startedAt ? `, started ${iso(run.startedAt)}` : ''}${run.error ? `, error: ${run.error}` : ''}`,
          answer
            ? `<answer>\n${answer.length > OUTPUT_CHARS ? `${answer.slice(0, OUTPUT_CHARS - 1)}…` : answer}\n</answer>`
            : null,
          transcript
            ? `<transcript>\n${transcript}\n</transcript>`
            : 'There is no transcript of that run.',
        ]
          .filter(Boolean)
          .join('\n\n')
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: instructions },
    { role: 'user', content: record },
  ];
}
