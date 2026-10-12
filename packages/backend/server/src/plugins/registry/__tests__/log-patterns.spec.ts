import test from 'ava';

import { WARMUP } from '../baseline';
import { healthLogs, healthScript, healthStatus, LOGS_MARKER } from '../health';
import {
  acceptPattern,
  ingestLogs,
  isKnown,
  KNOWN_AFTER,
  type LogPattern,
  mask,
  MAX_PATTERNS,
  readCatalog,
  redact,
  words,
} from '../log-patterns';

const HOUR = 3600;

/** Scans of `lines()` an hour apart, carrying the catalog like the service does. */
function train(n: number, lines: (i: number) => string[], catalog: LogPattern[] = [], start = 0) {
  let patterns = catalog;
  for (let i = 0; i < n; i++) {
    patterns = ingestLogs(patterns, lines(i), {
      scans: start + i,
      hours: 1,
      now: (start + i) * HOUR,
      sensitivity: 3,
    }).patterns;
  }
  return patterns;
}

const conn = (i: number) =>
  `2026-10-10T10:00:0${i % 10}+0000 box app[${1000 + i}]: Failed to connect to db 10.0.${i % 9}.7 after ${i % 5} retries`;

test('redacts secrets before anything else sees the line', t => {
  const line = redact(
    'login ok user=bob@example.com password=hunter2 Authorization: Bearer abc.def-ghi ' +
      'key AKIAABCDEFGHIJKLMNOP jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl url https://me:pw@host/x'
  );
  t.false(line.includes('hunter2'));
  t.false(line.includes('bob@example.com'));
  t.false(line.includes('abc.def-ghi'));
  t.false(line.includes('AKIAABCDEFGHIJKLMNOP'));
  t.false(line.includes('eyJhbGciOi'));
  t.false(line.includes('me:pw@'));
  t.true(line.includes('password=<redacted>'));
  t.true(line.includes('<email>'));
});

test('masks what varies between like lines', t => {
  t.is(mask(conn(3)), '<*> box app[<*>]: Failed to connect to db <*> after <*> retries');
  t.is(mask('took 12.5ms id 3f9a2c1e9b'), 'took <*>ms id <*>');
  t.is(
    mask('job 0b6e1f3a-2c4d-4e5f-8a9b-0c1d2e3f4a5b done at 12:01:33'),
    'job <*> done at <*>'
  );
});

test('lines that differ only in values become one pattern', t => {
  const { patterns } = ingestLogs([], [conn(1), conn(2), conn(3)], {
    scans: 0,
    hours: 1,
    now: 0,
    sensitivity: 3,
  });
  t.is(patterns.length, 1);
  t.is(patterns[0].count, 3);
});

test('lines that differ in a word merge, and the word becomes <*>', t => {
  const { patterns } = ingestLogs(
    [],
    [
      'sshd[1]: Invalid user alice from 1.2.3.4 port 22',
      'sshd[2]: Invalid user bob from 1.2.3.5 port 22',
      'kernel: usb 1-1: new high-speed USB device',
    ],
    { scans: 0, hours: 1, now: 0, sensitivity: 3 }
  );
  t.is(patterns.length, 2);
  const ssh = patterns.find(p => p.template.startsWith('sshd'));
  t.is(ssh?.template, 'sshd[<*>]: Invalid user <*> from <*> port <*>');
  t.is(ssh?.count, 2);
});

test('nothing is new while the catalog is still learning', t => {
  const scan = ingestLogs([], ['something odd happened'], {
    scans: WARMUP - 1,
    hours: 1,
    now: 0,
    sensitivity: 3,
  });
  t.is(scan.findings.length, 0);
  t.is(scan.patterns.length, 1);
});

test('a line never seen before is new once the catalog knows the machine', t => {
  const catalog = train(WARMUP, i => [conn(i)]);
  const scan = ingestLogs(catalog, [conn(1), 'kernel: Out of memory: Killed process 4242 (node)'], {
    scans: WARMUP,
    hours: 1,
    now: WARMUP * HOUR,
    sensitivity: 3,
  });
  t.is(scan.findings.length, 1);
  const [finding] = scan.findings;
  t.is(finding.kind, 'new');
  t.is(finding.severity, 'critical');
  t.true(finding.metric.startsWith('log:'));
  t.regex(finding.summary, /New in the logs \(1×\): "kernel: Out of memory: Killed process <\*> \(node\)"/);
  // The known pattern at its usual rate says nothing.
  t.false(scan.findings.some(f => f.metric === `log:${catalog[0].id}`));
});

test('a known line logged far more than usual is a spike, and is not learned as normal', t => {
  const catalog = train(WARMUP + 5, i => [conn(i), conn(i + 1)]);
  const before = catalog[0].rate.mean;
  const burst = Array.from({ length: 60 }, (_, i) => conn(i));
  const scan = ingestLogs(catalog, burst, {
    scans: WARMUP + 5,
    hours: 1,
    now: 100 * HOUR,
    sensitivity: 3,
  });
  t.is(scan.findings.length, 1);
  const [spike] = scan.findings;
  t.is(spike.kind, 'anomaly');
  t.is(spike.value, 60);
  t.is(spike.baseline, 2);
  t.true((spike.score ?? 0) >= 3);
  t.is(spike.severity, 'critical');
  t.regex(spike.summary, /is logged 60\/h; normal here is about 2\/h/);
  t.is(scan.patterns[0].rate.mean, before);
});

test('a small rise on a quiet pattern is not a spike', t => {
  const catalog = train(WARMUP + 5, i => (i % 2 ? [conn(i)] : []));
  const scan = ingestLogs(catalog, [conn(1), conn(2), conn(3)], {
    scans: WARMUP + 5,
    hours: 1,
    now: 100 * HOUR,
    sensitivity: 3,
  });
  t.is(scan.findings.length, 0);
});

test('rates are per hour, whatever time a scan covers', t => {
  const catalog = train(WARMUP + 5, i => Array.from({ length: 10 }, (_, j) => conn(i + j)));
  // 20 lines over two hours is the usual 10/h.
  const scan = ingestLogs(catalog, Array.from({ length: 20 }, (_, j) => conn(j)), {
    scans: WARMUP + 5,
    hours: 2,
    now: 100 * HOUR,
    sensitivity: 3,
  });
  t.is(scan.findings.length, 0);
});

test('expected on a pattern labels it known and widens its rate', t => {
  const [pattern] = train(WARMUP, i => [conn(i)]);
  t.false(isKnown(pattern));
  const accepted = acceptPattern(pattern, 40);
  t.true(isKnown(accepted));
  t.true(accepted.rate.mean > pattern.rate.mean);
  t.true(isKnown({ label: null, count: KNOWN_AFTER }));
});

test('the catalog stays bounded', t => {
  // Distinct programs (letters only, so nothing is masked), each its own pattern.
  const name = (i: number) => (i + 1000).toString(26).replace(/\d/g, d => 'qrstuvwxyz'[Number(d)]);
  const lines = Array.from({ length: MAX_PATTERNS + 50 }, (_, i) => `${name(i)} started`);
  t.deepEqual(words(lines[0]), [name(0), 'started']);
  const { patterns } = ingestLogs([], lines, { scans: 0, hours: 1, now: 0, sensitivity: 3 });
  t.is(patterns.length, MAX_PATTERNS);
});

test('a stored catalog is read back, leaving out what is malformed', t => {
  const [pattern] = train(1, () => [conn(1)]);
  t.deepEqual(readCatalog([pattern, { nope: 1 }, null]), [pattern]);
  t.deepEqual(readCatalog('junk'), []);
});

test('the health check reads logs only when asked, and their lines come back apart', t => {
  t.false(healthScript(null).includes('journalctl'));
  const script = healthScript(1_700_000_000);
  t.true(script.includes('--since "@1700000000"'));
  t.true(script.includes(LOGS_MARKER));
  t.true(script.trim().endsWith('exit 0'));

  const output = ['cpus=4', 'disk=41', `${LOGS_MARKER} 1700003600`, conn(1), '', conn(2)].join('\n');
  t.deepEqual(healthLogs(output), { lines: [conn(1), conn(2)], until: 1700003600 });
  t.is(healthLogs('cpus=4\ndisk=41'), null);
  // A log line that looks like key=value is not read as a check.
  const status = healthStatus(`disk=41\n${LOGS_MARKER} 1\nmem=99`);
  t.false(status.checks.some(c => c.name === 'Memory'));
});
