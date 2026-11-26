/**
 * Interview calendar events: an automation that spots events on the
 * workspace calendar that might be interviews and hands each to an agent,
 * which decides whether it is one, tags it, and adds the candidate's CV and
 * LinkedIn link, found in the notes the Slack sync brought in.
 *
 * The code does the cheap, deterministic half (read the calendar, skip what
 * it has already handed over, queue the agent); the judgement calls are the
 * agent's. Like the nightly passes it works only through the sandbox's
 * `notesgraph` helper. Keep the code free of template literals and
 * backticks: it is embedded in String.raw below.
 */

export const INTERVIEW_EVENTS_TEMPLATE = String.raw`// Every run looks at the next LOOKAHEAD_DAYS of the workspace calendar,
// keeps the events that could be interviews, and queues one agent run for
// each it has not handed over before. The agent classifies the event, tags
// the event's note #interview, and adds the candidate's CV and LinkedIn link,
// searching the notes the Slack sync imported. Set AGENT_DEVICE to the key of
// a device that runs agents, and CALENDAR to part of the name of the
// calendar to watch (empty: all of them).
const AGENT_DEVICE = '';
const CALENDAR = 'pantheon';
const LOOKAHEAD_DAYS = 14;
const LEDGER_TITLE = 'Interview events handed to the agent';
const LEDGER_FOLDER = ['ai', 'automations'];
const MAYBE_INTERVIEW = /interview|screen(ing)?\b|candidate|hiring|recruit|intro call|phone call|onsite|on-site|panel|debrief/i;
const ws = notesgraph.workspaceId;

if (!AGENT_DEVICE) {
  throw new Error('set AGENT_DEVICE at the top of the code to the key of a device that runs agents');
}

const from = new Date();
const to = new Date(from.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000);
const query = 'query($id: String!, $from: DateTime!, $to: DateTime!) { workspace(id: $id) { calendars { displayNameOverride enabled events(from: $from, to: $to) { externalEventId title description location startAtUtc endAtUtc status } } } }';
const reply = await notesgraph.fetch('/graphql', {
  method: 'POST',
  body: { query, variables: { id: ws, from: from.toISOString(), to: to.toISOString() } },
});
if (reply.errors && reply.errors.length) {
  throw new Error('calendar query failed: ' + reply.errors[0].message);
}
const wanted = CALENDAR.trim().toLowerCase();
const events = [];
for (const calendar of reply.data.workspace.calendars) {
  if (!calendar.enabled) continue;
  if (wanted && !String(calendar.displayNameOverride || '').toLowerCase().includes(wanted)) continue;
  for (const event of calendar.events) {
    if (event.status === 'cancelled') continue;
    if (!MAYBE_INTERVIEW.test((event.title || '') + ' ' + (event.description || ''))) continue;
    events.push(event);
  }
}

const { docs } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs?q=' + encodeURIComponent(LEDGER_TITLE) + '&limit=20');
const ledger = docs.find(d => d.title.trim().toLowerCase() === LEDGER_TITLE.toLowerCase());
let seen = new Set();
let ledgerText = '';
if (ledger) {
  const { markdown } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(ledger.docId) + '/markdown');
  ledgerText = String(markdown || '');
  for (const m of ledgerText.matchAll(/^- (\S+)/gm)) seen.add(m[1]);
}

const fresh = events.filter(e => !seen.has(e.externalEventId));
const queued = [];
for (const event of fresh) {
  const when = event.startAtUtc;
  const instructions = [
    'A calendar event may be a job interview. Decide, then add what the interviewer needs.',
    '',
    'Event: ' + (event.title || '(untitled)'),
    'Starts: ' + when + ' (ends ' + event.endAtUtc + ')',
    event.location ? 'Where: ' + event.location : '',
    'Event id: ' + event.externalEventId,
    'Description:',
    String(event.description || '(none)').slice(0, 4000),
    '',
    '1. Classify: is this a job interview with a candidate (not a standup, a 1:1, or an interview for a podcast)? If not, stop and say why in one line.',
    '2. Find the event note (the note whose calendarEvent property has this event id, or one titled like the event); create one titled after the event if there is none. Add the tag #interview and #candidate:<name>.',
    '3. Work out the candidate name from the title and description. Search NotesGraph (keyword_search, then semantic_search) for their CV, in the notes the Slack sync imported (Slack channels and messages), and for their LinkedIn URL.',
    '4. In the event note add a "Candidate" section with the CV (a link to the note, or the file link from Slack) and the LinkedIn URL. Write only what you found; if you found neither, say so. Never guess a URL.',
  ].filter(l => l !== '').join('\n');
  const { job } = await notesgraph.fetch('/api/registry/workspaces/' + ws + '/devices/' + encodeURIComponent(AGENT_DEVICE) + '/jobs', {
    method: 'POST',
    body: { agentId: 'interview-events', agentName: 'Interview events', title: 'Interview: ' + (event.title || 'event').slice(0, 80), instructions },
  });
  queued.push(event.externalEventId);
  console.log('queued ' + job.id + ' for ' + (event.title || event.externalEventId));
}

if (queued.length) {
  const markdown = (ledgerText ? ledgerText + '\n' : 'Calendar events the interview automation has handed to an agent, so it does not queue them twice.\n\n') +
    queued.map(id => '- ' + id).join('\n');
  if (ledger) {
    await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(ledger.docId), { method: 'PUT', body: { markdown } });
  } else {
    await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs', { method: 'POST', body: { title: LEDGER_TITLE, markdown, folder: LEDGER_FOLDER } });
  }
}
const summary = queued.length + ' queued of ' + events.length + ' possible interviews';
console.log(summary);
return { summary, queued };
`;

export const INTERVIEW_TEMPLATES = [
  {
    id: 'interview-events',
    name: 'Tag interview events and add the candidate CV and LinkedIn',
    description:
      "Every 30 minutes, find upcoming calendar events that look like interviews and queue an agent for each: it classifies the event, tags it #interview, and adds the candidate's CV and LinkedIn link found in the Slack-synced notes. Set the agent device at the top of the code.",
    triggers: [{ type: 'interval', minutes: 30 }],
    code: INTERVIEW_EVENTS_TEMPLATE,
    timeoutSeconds: 5 * 60,
  },
];
