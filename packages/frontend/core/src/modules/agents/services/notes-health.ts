import type { AgentTemplate } from './agent-templates';
import type { Monitor, MonitorDraft } from './monitors';
import { CLAUDE_CODE_MODEL, CLOUD_DEVICE_KEY } from './remote-runner';

/**
 * The notes health check: a weekly agent run that reads the whole workspace
 * the way a person tidying it would, and writes what it found into a report
 * note as to-dos. It never fixes anything itself; the person ticks off what
 * they agree with. The mechanical findings (orphans, broken links, duplicate
 * titles, stubs, stale "as of" facts) come from the notes_health tool on the
 * server, so the agent's own reading goes to what needs judgement.
 */

export const NOTES_HEALTH_NAME = 'Notes health check';
export const NOTES_HEALTH_DOC_TITLE = 'Notes health';
export const WEEK_MINUTES = 7 * 24 * 60;

export const NOTES_HEALTH_INSTRUCTIONS = [
  "You check the health of the user's notes and write a report. You only",
  'report: never edit, merge, move, link or delete any note other than the',
  'report itself, even when the fix looks obvious. Every fix is offered as a',
  'to-do for the user to decide on.',
  '',
  'How to work:',
  '1. Call the notes_health tool. It lists orphans (notes nothing links to),',
  '   broken links, notes with duplicate titles, stubs (notes with almost no',
  '   body) and stale facts (blocks stamped "as of <date>" long ago). Trust it',
  '   for these and do not search for them by hand.',
  '2. Drop what is not a problem: the report notes themselves and the note',
  `   "${NOTES_HEALTH_DOC_TITLE}", "Agent memory", and notes that are plainly`,
  '   meant to stand alone (a top-level index or hub). Read a pair of',
  '   duplicate titles before calling them duplicates; two notes on the same',
  '   subject with different content may both belong. A note that is only a',
  '   board, a table or an embed can look like a stub; skip those.',
  '3. Look for contradictions, which the tool cannot find: read "Agent',
  '   memory" and the notes it links to, and for each person or topic there,',
  '   search for other notes about the same one. Report two notes that state',
  '   different facts about the same thing (an age, a relationship, a date, a',
  '   preference), quoting both. Prefer the newer "as of" when saying which',
  '   looks current, but leave the decision to the user.',
  '4. Write the report as a new note titled "Notes health <today, YYYY-MM-DD>"',
  '   with create_document, and link it from the note this run belongs to with',
  '   link_document. One heading per check, in this order: Contradictions,',
  '   Stale facts, Broken links, Near-duplicates, Orphans, Stubs. Under each,',
  '   one to-do (a "- [ ]" item) per finding, naming the note by title and',
  '   saying the fix, e.g.:',
  '   - [ ] "Cosmo" says 7 years old (as of 2025-01-02): check it still holds',
  '   - [ ] "Trip plan" links to a note that no longer exists: remove the link',
  '   - [ ] Merge "Cosmo" and "cosmo notes" on the Duplicates page (<path>)',
  '   - [ ] Link "Gift ideas" from a note it belongs under',
  '   - [ ] "Draft" is nearly empty: fill it in or delete it',
  '   For near-duplicates give the Duplicates page path the tool returns, so',
  '   the merge is one click there. Leave a heading out when it has nothing;',
  '   past 20 findings under one heading, list the first 20 and say how many',
  '   more there are.',
  '5. Finish with one line counting each kind, e.g. "2 contradictions, 3',
  '   stale facts, 1 broken link, 2 duplicates, 4 orphans, 5 stubs", or "All',
  '   healthy" when there is nothing. If everything is healthy, skip the',
  '   report note.',
].join('\n');

/** Run on demand from a note, with the same instructions as the weekly run. */
export const NOTES_HEALTH_TEMPLATE: AgentTemplate = {
  id: 'notes-health',
  label: 'Notes health check',
  draft: {
    name: NOTES_HEALTH_NAME,
    instructions: NOTES_HEALTH_INSTRUCTIONS,
    kind: 'worker',
    // Claude Code on the server's runner: NotesGraph's tools, nothing else.
    harness: 'remote',
    model: CLAUDE_CODE_MODEL,
    deviceKey: CLOUD_DEVICE_KEY,
    tools: [],
    targets: ['doc'],
    output: 'panel',
    maxSteps: 60,
    enabled: true,
  },
};

/**
 * Where the weekly run goes: the server's own runner when it has one, so it
 * runs with no Mac on, or else the first device that takes agent work. Null
 * when nothing can run it.
 */
export function notesHealthDevice(devices: { key: string }[]): string | null {
  if (devices.some(device => device.key === CLOUD_DEVICE_KEY)) {
    return CLOUD_DEVICE_KEY;
  }
  return devices[0]?.key ?? null;
}

/**
 * The weekly monitor: an agent run that keeps the given block to a one-line
 * summary of the latest report, and tells the person in the app each time.
 */
export function notesHealthMonitorDraft(
  docId: string,
  blockId: string,
  deviceKey: string
): MonitorDraft {
  return {
    name: NOTES_HEALTH_NAME,
    docId,
    blockId,
    kind: 'agent',
    source: null,
    deviceKey,
    spec: {
      instructions: NOTES_HEALTH_INSTRUCTIONS,
      model: CLAUDE_CODE_MODEL,
      tools: [],
    },
    intervalMinutes: WEEK_MINUTES,
    condition: { type: 'always' },
    alerts: { inApp: true },
  };
}

/** Whether one is set up already, so it isn't offered twice. */
export const isNotesHealthMonitor = (monitor: Pick<Monitor, 'kind' | 'name'>) =>
  monitor.kind === 'agent' && monitor.name === NOTES_HEALTH_NAME;
