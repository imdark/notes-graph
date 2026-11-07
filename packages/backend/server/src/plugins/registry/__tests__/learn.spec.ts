import test from 'ava';

import {
  checkedIds,
  detectLearnings,
  errorSignature,
  renderProposals,
  type RunRecord,
  scanRun,
} from '../learn';

const stamp = '[2026-11-06T03:00:00.000Z] ';
const transcript = (lines: string[]) =>
  lines.map(line => `${stamp}${line}`).join('\n');

const run = (
  id: string,
  lines: string[],
  questions: string[] = []
): RunRecord => ({
  id,
  title: `Run ${id}`,
  log: transcript(lines),
  questions,
});

const failingBash = (n: number) =>
  Array.from({ length: n }, () => [
    '→ Bash  {"command":"yarn vitest run packages/x","description":"Run tests"}',
    '  ✗ <tool_use_error>Exit code 127 /bin/sh: vitest: command not found</tool_use_error>',
  ]).flat();

test('an error signature drops the parts that vary', t => {
  t.is(
    errorSignature(
      "Exit code 1 ENOENT: no such file, open '/tmp/a/b.txt' at line 42"
    ),
    'ENOENT: no such file, open <q> at line <n>'
  );
  t.is(
    errorSignature('commit deadbeef1234 not found'),
    'commit <id> not found'
  );
  t.is(
    errorSignature(
      'Traceback (most recent call last):\n  File x\nKeyError: 42'
    ),
    'KeyError: <n>'
  );
  t.is(errorSignature('<tool_use_error>Exit code 2</tool_use_error>'), '');
});

test('a run stuck on one failing command is a stuck finding', t => {
  const scans = [scanRun(run('a', failingBash(3)))];
  const [finding] = detectLearnings(scans);
  t.is(finding.kind, 'stuck');
  t.regex(finding.summary, /Bash failed 3\+ times \(up to 3\) in one run/);
  t.deepEqual(finding.examples, ['yarn vitest run packages/x']);
  t.false(finding.untrusted);
});

test('the same failure across three runs is a recurring error, not a stuck one', t => {
  const scans = ['a', 'b', 'c'].map(id => scanRun(run(id, failingBash(1))));
  const findings = detectLearnings(scans);
  t.is(findings.length, 1);
  t.is(findings[0].kind, 'recurring_error');
  t.deepEqual(
    findings[0].runs.map(r => r.id),
    ['a', 'b', 'c']
  );
});

test('two runs asking the user the same thing is a repeated question', t => {
  const scans = [
    scanRun(
      run('a', [
        '? asking you: Which workspace should the note go in?  (answer in NotesGraph)',
      ])
    ),
    scanRun(run('b', [], ['which workspace should the note go in'])),
    scanRun(run('c', [], ['Deploy to prod now?'])),
  ];
  const findings = detectLearnings(scans);
  t.is(findings.length, 1);
  t.is(findings[0].kind, 'repeated_question');
  t.regex(findings[0].summary, /Asked the user in 2 runs/);
});

test('re-reading a file without writing it is a reread; a write resets it', t => {
  const read = '→ Read  {"file_path":"/repo/src/a.ts"}';
  const ok = '  ← contents';
  const rereader = scanRun(run('a', [read, ok, read, ok, read, ok]));
  t.is(rereader.reads.get('Read\t/repo/src/a.ts'), 3);
  const writer = scanRun(
    run('b', [
      read,
      ok,
      read,
      ok,
      '→ Edit  {"file_path":"/repo/src/a.ts","old_string":"x","new_string":"y"}',
      '  ← ok',
      read,
      ok,
    ])
  );
  t.is(writer.reads.get('Read\t/repo/src/a.ts'), 2);
  const [finding] = detectLearnings([rereader, writer]);
  t.is(finding.kind, 'reread');
  t.is(finding.runs[0].id, 'a');
});

test('a subagent line counts like its parent and web reads mark the run', t => {
  const scan = scanRun(
    run('a', [
      '→ Task  {"prompt":"look"}',
      '    ↳ → WebFetch  {"url":"https://example.com"}',
      '    ↳   ✗ fetch failed: 503',
      '    ↳ → WebFetch  {"url":"https://example.com"}',
      '    ↳   ✗ fetch failed: 503',
      '    ↳ → WebFetch  {"url":"https://example.com"}',
      '    ↳   ✗ fetch failed: 503',
      '  ← done',
    ])
  );
  t.true(scan.untrusted);
  const findings = detectLearnings([scan]);
  // The failed fetches are both a stuck finding and, as reads, a reread.
  t.deepEqual(findings.map(f => f.kind).sort(), ['reread', 'stuck']);
  t.true(findings.every(f => f.untrusted));
});

test('the note keeps a ticked finding ticked and drops one no longer seen', t => {
  const scans = [scanRun(run('a', failingBash(3)))];
  const findings = detectLearnings(scans);
  const first = renderProposals(findings, {
    runsScanned: 1,
    at: new Date('2026-11-06T04:00:00Z'),
  });
  t.regex(first, /1 runs scanned on 2026-11-06/);
  t.regex(
    first,
    new RegExp(`- \\[ \\] \`${findings[0].id}\` \\*\\*stuck\\*\\*`)
  );
  t.notRegex(first, /review closely/);

  const ticked = first.replace(
    `- [ ] \`${findings[0].id}\``,
    `- [x] \`${findings[0].id}\``
  );
  t.deepEqual([...checkedIds(ticked)], [findings[0].id]);
  const second = renderProposals(findings, {
    runsScanned: 2,
    at: new Date('2026-11-07T04:00:00Z'),
    previous: ticked,
  });
  t.regex(second, new RegExp(`- \\[x\\] \`${findings[0].id}\``));

  const empty = renderProposals([], {
    runsScanned: 2,
    at: new Date('2026-11-08T04:00:00Z'),
    previous: ticked,
  });
  t.regex(empty, /No repeated mistakes found/);
  t.notRegex(empty, /F-/);
});
