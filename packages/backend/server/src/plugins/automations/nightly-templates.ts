/**
 * The nightly passes, as automations: code that runs on a device the
 * workspace registered (the cloud runner on a self-hosted box will do) and
 * works through the workspace over the ordinary API as the person who made
 * the automation, through the sandbox's `notesgraph` helper
 * (docs/reference/automations.md). Nothing here is special to the server:
 * no pass-specific endpoint, no config flag. Turn one on by starting an
 * automation from the template; pause, reschedule and read its runs on the
 * Automations page like any other.
 *
 * Both are tested by running them under node against a fake `notesgraph`
 * (__tests__/nightly-templates.spec.ts). Keep the code free of template
 * literals and backticks: it is embedded in String.raw below.
 */

/** Titles untitled notes from their first sentence; trashes empty ones. */
export const TITLE_UNTITLED_NOTES_TEMPLATE = String.raw`// Every note with no title gets one from the first sentence of its body
// (up to 60 characters, cut at a word). A note with no body either is moved
// to the trash (restorable). A body with nothing to title it by is left alone.
const MAX_TITLE = 60;
const ws = notesgraph.workspaceId;

function generateTitle(body) {
  const firstLine = body
    .split(/\r?\n/)
    .map(line => line.replace(/^[\s#>*\-•\d.)\]\[]+/, '').trim())
    .find(Boolean);
  if (!firstLine) return null;
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0].replace(/[.!?:,;\s]+$/, '');
  if (!sentence) return null;
  if (sentence.length <= MAX_TITLE) return sentence;
  const cut = sentence.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/, '') + '…';
}

const { docs } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs?limit=1000');
const untitled = docs.filter(doc => !doc.title.trim() && doc.docId !== ws);
const titled = [];
const empty = [];
const trashed = [];
const unnamed = [];
for (const doc of untitled) {
  const { markdown } = await notesgraph.fetch(
    '/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(doc.docId) + '/markdown'
  );
  const title = generateTitle(markdown || '');
  if (!title) {
    if ((markdown || '').trim()) {
      // a body with no sentence to name it by (an image, say): not empty
      unnamed.push(doc.docId);
      console.log('has a body but no sentence to title it, left alone: ' + doc.docId);
      continue;
    }
    empty.push(doc.docId);
    await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(doc.docId), {
      method: 'DELETE',
    });
    trashed.push(doc.docId);
    console.log('empty, moved to trash: ' + doc.docId);
    continue;
  }
  await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(doc.docId), {
    method: 'PUT',
    body: { title },
  });
  titled.push({ docId: doc.docId, title });
  console.log('titled ' + doc.docId + ': ' + title);
}
const summary =
  titled.length + ' titled, ' + empty.length + ' empty trashed, ' + unnamed.length + ' left of ' + untitled.length + ' untitled';
console.log(summary);
// summary is what a monitor running this records as its reading
return { summary, titled, empty, trashed, unnamed };
`;

/**
 * The counting half of wf learn: repeated mistakes over recent agent runs,
 * kept as to-dos in a "Proposed harness changes" note. Proposals only.
 */
export const LEARN_FROM_RUNS_TEMPLATE = String.raw`// Counts over the last 14 days of agent runs and of the Claude Code
// conversations wf publishes as notes, no model: the same tool
// failing the same way 3+ times in one run (stuck), the same failure in 3+
// runs (recurring), the same question asked of you in 2+ runs, the same
// file or note read 3+ times with no write between (reread). The findings
// keep the note "Proposed harness changes" current, under ai / proposals.
// A to-do you ticked stays ticked; a finding no longer seen is dropped.
// Nothing is applied: these are proposals for the Agent rules note, a skill
// or Agent memory. A run that read web content marks its findings
// "review closely".
const DAYS = 14;
const MAX_FINDINGS = 10;
const STUCK_MIN = 3;
const RECURRING_MIN_RUNS = 3;
const QUESTION_MIN_RUNS = 2;
const REREAD_MIN = 3;
const NOTE_TITLE = 'Proposed harness changes';
const FOLDER = ['ai', 'proposals'];
const UNTRUSTED = /^(WebFetch|WebSearch|mcp__omniseek__|mcp__claude-in-chrome__|mcp__Claude_Browser__)/;
const READ_TOOLS = {
  Read: 'file_path',
  WebFetch: 'url',
  mcp__notesgraph__read_document: 'docId',
  mcp__notesgraph__read_section: 'docId',
};
const READ_PARTS = ['offset', 'limit', 'pages', 'section', 'sectionId', 'blockId', 'heading'];
const WRITE_TOOLS = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  mcp__notesgraph__update_document: 'docId',
  mcp__notesgraph__update_block: 'docId',
};
const ws = notesgraph.workspaceId;
const api = '/api/registry/workspaces/' + ws;

const short = (text, n = 160) => {
  const flat = String(text).split(/\s+/).filter(Boolean).join(' ');
  return flat.length <= n ? flat : flat.slice(0, n - 1) + '…';
};
// A string, number or boolean field of a tool input logged as JSON. Read's
// offset and limit are numbers.
const field = (input, name) => {
  const m = new RegExp('"' + name + '":(?:"((?:[^"\\\\]|\\\\.)*)"|(-?\\d+(?:\\.\\d+)?|true|false))').exec(input);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
};
function signature(text) {
  const lines = String(text)
    .replace(/<\/?tool_use_error>/g, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    // npx prints "npm warn Unknown project config ..." ahead of the real error
    .filter(l => l && !/^Exit code \d+$/.test(l) && !/^npm warn /i.test(l));
  if (!lines.length) return '';
  let line = lines[0].startsWith('Traceback') ? lines[lines.length - 1] : lines[0];
  line = line.replace(/(['"]).*?\1/g, '<q>');
  line = line.replace(/(?:~|\.{0,2})?\/[\w.\-\/@]+/g, '<path>');
  line = line.replace(/\b[0-9a-f]{7,}\b/g, '<id>');
  line = line.replace(/^Exit code \d+\s*/i, '');
  line = line.replace(/\d+/g, '<n>');
  return line.slice(0, 140);
}
const words = text => new Set((String(text).toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2));
const similar = (a, b) => {
  if (!a.size || !b.size) return false;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both) >= 0.7;
};

// Transcript lines as the runner writes them: "[stamp] → Tool  {json}",
// "[stamp]   ✗ error" / "  ← result", "? asking you: … (answer in NotesGraph)",
// a subagent's lines prefixed "    ↳ ".
function scan(run) {
  const queues = { main: [], sub: [] };
  const errors = [];
  const questions = (run.questions || []).filter(q => q.kind === 'question').map(q => q.text);
  const current = new Map();
  const peak = new Map();
  let untrusted = false;
  for (const raw of (run.log || '').split('\n')) {
    const unstamped = raw.replace(/^\[[^\]]*\]\s?/, '');
    const sub = /^\s*↳\s?/.test(unstamped);
    const line = unstamped.replace(/^\s*↳\s?/, '');
    const pending = sub ? queues.sub : queues.main;
    const call = /^→\s+(\S+)\s*(.*)$/.exec(line);
    if (call) {
      const [, tool, input] = call;
      pending.push({ tool, input });
      if (UNTRUSTED.test(tool)) untrusted = true;
      const target = READ_TOOLS[tool] ? field(input, READ_TOOLS[tool]) : null;
      // The runner cuts a logged input at 160 characters. Past a long path
      // that drops offset and limit, so a cut read can't be told apart from
      // the other parts of its file and isn't counted.
      if (target && input.endsWith('…')) continue;
      if (target) {
        const key = tool + '\t' + target + '\t' + READ_PARTS.map(f => field(input, f) || '').join('\0');
        const n = (current.get(key) || 0) + 1;
        current.set(key, n);
        peak.set(key, Math.max(peak.get(key) || 0, n));
        continue;
      }
      const written = WRITE_TOOLS[tool] ? field(input, WRITE_TOOLS[tool]) : null;
      if (written) {
        for (const key of current.keys()) if (key.split('\t')[1] === written) current.set(key, 0);
      } else if (tool === 'Bash') {
        const command = field(input, 'command') || '';
        for (const key of current.keys()) {
          const t = key.split('\t')[1];
          const base = t.split('/').pop() || t;
          if (command.includes(t) || command.split(/\s+/).includes(base)) current.set(key, 0);
        }
      }
      continue;
    }
    const result = /^\s*(✗|←)\s?(.*)$/.exec(line);
    if (result) {
      const c = pending.shift();
      if (result[1] === '✗' && c) {
        const sig = signature(result[2]);
        if (sig) errors.push({ tool: c.tool, sig, example: short(field(c.input, 'command') || c.input, 120) });
      }
      continue;
    }
    const q = /^\?\s+asking you:\s*(.*?)\s*\(answer in NotesGraph\)\s*$/.exec(line);
    if (q && q[1]) questions.push(q[1]);
  }
  const reads = new Map();
  for (const [key, n] of peak) {
    const [tool, target] = key.split('\t');
    const k = tool + '\t' + target;
    reads.set(k, Math.max(reads.get(k) || 0, n));
  }
  return { id: run.id, title: (run.title || '').trim() || run.id.slice(0, 8), untrusted, errors, reads, questions };
}

function detect(scans) {
  const findings = [];
  const runOf = new Map(scans.map(s => [s.id, { id: s.id, title: s.title }]));
  const untrusted = new Set(scans.filter(s => s.untrusted).map(s => s.id));
  const anyUntrusted = ids => ids.some(id => untrusted.has(id));
  const runs = ids => [...ids].sort().map(id => runOf.get(id));
  const bySig = new Map();
  const stuck = new Map();
  const add = (e, ex) => { if (e.examples.length < 3 && !e.examples.includes(ex)) e.examples.push(ex); };
  for (const s of scans) {
    const perRun = new Map();
    for (const { tool, sig, example } of s.errors) {
      const key = tool + '\t' + sig;
      perRun.set(key, [...(perRun.get(key) || []), example]);
      const e = bySig.get(key) || { runs: new Set(), count: 0, examples: [] };
      e.runs.add(s.id); e.count++; add(e, example); bySig.set(key, e);
    }
    for (const [key, examples] of perRun) {
      if (examples.length < STUCK_MIN) continue;
      const e = stuck.get(key) || { runs: new Set(), peak: 0, examples: [] };
      e.runs.add(s.id); e.peak = Math.max(e.peak, examples.length);
      for (const ex of examples) add(e, ex);
      stuck.set(key, e);
    }
    for (const [key, n] of s.reads) {
      if (n < REREAD_MIN) continue;
      const [tool, target] = key.split('\t');
      findings.push({ kind: 'reread', summary: short(target, 100) + ' read ' + n + ' times in one run (' + tool + '), no write in between', count: n, runs: runs([s.id]), examples: [], untrusted: untrusted.has(s.id) });
    }
  }
  for (const [key, e] of stuck) {
    const [tool, sig] = key.split('\t');
    const where = e.runs.size === 1 ? 'one run' : e.runs.size + ' runs';
    findings.push({ kind: 'stuck', summary: tool + ' failed ' + STUCK_MIN + '+ times (up to ' + e.peak + ') in ' + where + ' with: ' + sig, count: e.peak, runs: runs(e.runs), examples: e.examples, untrusted: anyUntrusted([...e.runs]) });
  }
  for (const [key, e] of bySig) {
    if (stuck.has(key) || e.runs.size < RECURRING_MIN_RUNS) continue;
    const [tool, sig] = key.split('\t');
    findings.push({ kind: 'recurring error', summary: tool + ' failed in ' + e.runs.size + ' runs with: ' + sig, count: e.count, runs: runs(e.runs), examples: e.examples, untrusted: anyUntrusted([...e.runs]) });
  }
  const groups = [];
  for (const s of scans) {
    for (const question of s.questions) {
      const w = words(question);
      const g = groups.find(g => similar(g.words, w));
      if (g) g.runs.add(s.id); else groups.push({ words: w, question, runs: new Set([s.id]) });
    }
  }
  for (const g of groups) {
    if (g.runs.size < QUESTION_MIN_RUNS) continue;
    findings.push({ kind: 'repeated question', summary: 'Asked the user in ' + g.runs.size + ' runs: ' + short(g.question), count: g.runs.size, runs: runs(g.runs), examples: [], untrusted: anyUntrusted([...g.runs]) });
  }
  findings.sort((a, b) => b.runs.length - a.runs.length || b.count - a.count);
  return findings.slice(0, MAX_FINDINGS);
}

// A stable id per finding, so a ticked box survives the nightly rewrite.
async function findingId(f) {
  const data = new TextEncoder().encode(f.kind + '\0' + f.summary);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return 'F-' + [...new Uint8Array(digest)].slice(0, 3).map(b => b.toString(16).padStart(2, '0')).join('');
}
const BT = String.fromCharCode(96);
const md = text => String(text).replace(/[\\\u0060*_\[\]<>]/g, c => '\\' + c);

const since = new Date(Date.now() - DAYS * 86400000).toISOString();
const { jobs } = await notesgraph.fetch(api + '/jobs?kind=agent&since=' + since + '&limit=200');
const finished = jobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled');
console.log(finished.length + ' runs since ' + since.slice(0, 10));
const scans = [];
for (const j of finished) {
  const { job } = await notesgraph.fetch(api + '/jobs/' + encodeURIComponent(j.id) + '?logFrom=0');
  scans.push(scan(job));
}

// Claude Code conversations wf publishes as notes, titled
// "2026-10-21 TASK-13 · 9eb740b0": each tool call and result is rewritten
// as the runner's log lines and counted the same way. A result failed when
// it starts with a nonzero exit code or is a tool_use_error.
const CONVERSATION_TITLE = /^(\d{4}-\d{2}-\d{2}) .* · [0-9a-f]{8}$/;
const SECTION = /^### Tool (?:call: \u0060([^\u0060]+)\u0060|result)[ \t]*\n+\u0060\u0060\u0060[^\n]*\n([\s\S]*?)\n\u0060\u0060\u0060/gm;
function conversationLog(markdown) {
  const out = [];
  for (const m of String(markdown).matchAll(SECTION)) {
    const text = m[2].trim();
    if (m[1]) {
      let input = text.split(/\s+/).join(' ');
      try { input = JSON.stringify(JSON.parse(text)); } catch {}
      out.push('→ ' + m[1] + '  ' + input);
      continue;
    }
    if (!/^Exit code [1-9]\d*\b/.test(text) && !text.includes('<tool_use_error>')) {
      out.push('  ← ok');
      continue;
    }
    const errorLines = text
      .replace(/<\/?tool_use_error>/g, '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !/^Exit code \d+$/.test(l) && !/^npm warn /i.test(l) && !/^… \[\d+ chars truncated\]$/.test(l));
    const first = errorLines[0] || 'failed';
    out.push('  ✗ ' + (first.startsWith('Traceback') ? errorLines[errorLines.length - 1] : first));
  }
  return out.join('\n');
}
const sinceDay = since.slice(0, 10);
const listed = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs?q=&limit=1000');
const conversations = listed.docs.filter(d => {
  const m = CONVERSATION_TITLE.exec(d.title.trim());
  return m && m[1] >= sinceDay;
});
console.log(conversations.length + ' conversations since ' + sinceDay);
for (const c of conversations) {
  const { markdown } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(c.docId) + '/markdown');
  scans.push(scan({ id: c.docId, title: c.title.trim(), questions: [], log: conversationLog(markdown) }));
}
const seen = finished.length + ' runs and ' + conversations.length + ' conversations';

const findings = detect(scans);
for (const f of findings) f.id = await findingId(f);
for (const f of findings) console.log(f.id + ' ' + f.kind + ': ' + f.summary);

const { docs } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs?q=' + encodeURIComponent(NOTE_TITLE) + '&limit=20');
const existing = docs.find(d => d.title.trim().toLowerCase() === NOTE_TITLE.toLowerCase());
if (!existing && findings.length === 0) {
  console.log('no repeated mistakes in ' + seen + '; no note to write');
  return { runs: finished.length, conversations: conversations.length, findings: [] };
}
let kept = new Set();
if (existing) {
  const { markdown } = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(existing.docId) + '/markdown');
  for (const m of String(markdown || '').matchAll(/^- \[x\] \u0060(F-[0-9a-f]{6})\u0060/gim)) kept.add(m[1]);
}
const lines = [
  'Patterns counted over the agent runs and Claude Code conversations of the last ' + DAYS + ' days (' + seen + ' scanned on ' + new Date().toISOString().slice(0, 10) + '), no model. Nothing here is applied: each is a proposal for the "Agent rules" note, a skill or Agent memory. Tick one once you have acted on it; it stays ticked on later nights.',
  '',
  '## Findings',
];
if (findings.length === 0) lines.push('', 'No repeated mistakes found.');
for (const f of findings) {
  lines.push('', '- ' + (kept.has(f.id) ? '[x]' : '[ ]') + ' ' + BT + f.id + BT + ' **' + f.kind + '**: ' + md(f.summary), '  - seen in: ' + f.runs.map(r => md(r.title)).join(', '));
  for (const ex of f.examples) lines.push('  - e.g. ' + BT + ex + BT);
  if (f.untrusted) lines.push('  - review closely: a run behind this read web content');
}
const markdown = lines.join('\n');
let docId = existing && existing.docId;
if (docId) {
  await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs/' + encodeURIComponent(docId), { method: 'PUT', body: { markdown } });
} else {
  const created = await notesgraph.fetch('/api/notes/workspaces/' + ws + '/docs', { method: 'POST', body: { title: NOTE_TITLE, markdown, folder: FOLDER } });
  docId = created.docId;
}
console.log(findings.length + ' findings; "' + NOTE_TITLE + '" is up to date (' + docId + ')');
return { runs: finished.length, conversations: conversations.length, findings: findings.map(f => f.id + ' ' + f.summary), docId };
`;

export const NIGHTLY_TEMPLATES = [
  {
    id: 'title-untitled-notes',
    name: 'Title untitled notes nightly',
    description:
      'Every night at 3am, give each untitled note a title from the first sentence of its body and move the ones with no body either to the trash.',
    triggers: [{ type: 'cron', expr: '0 3 * * *' }],
    code: TITLE_UNTITLED_NOTES_TEMPLATE,
    timeoutSeconds: 10 * 60,
  },
  {
    id: 'learn-from-runs',
    name: 'Learn from agent runs and conversations nightly',
    description:
      'Every night at 4am, count repeated mistakes over the last 14 days of agent runs and Claude Code conversations and keep the "Proposed harness changes" note current. Proposals only.',
    triggers: [{ type: 'cron', expr: '0 4 * * *' }],
    code: LEARN_FROM_RUNS_TEMPLATE,
    timeoutSeconds: 10 * 60,
  },
];
